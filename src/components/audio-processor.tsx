import React, { useState, useEffect, useRef } from 'react';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import * as Tooltip from '@radix-ui/react-tooltip';
import { Upload, Settings2, Play, FileAudio, Download, FileTerminal, ArrowRight, Loader2, RefreshCw, Info, ChevronDown } from 'lucide-react';
import { motion } from 'motion/react';

const InfoTooltip = ({ title, children }: { title: string, children: React.ReactNode }) => (
  <Tooltip.Provider delayDuration={200}>
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <button type="button" className="text-slate-400 hover:text-indigo-500 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded-full inline-flex items-center">
          <Info className="w-4 h-4 ml-1.5" />
        </button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content 
          className="z-50 max-w-xs rounded-xl bg-slate-900 dark:bg-slate-800 dark:border dark:border-slate-700 p-4 text-xs leading-relaxed text-slate-100 shadow-xl animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2"
          sideOffset={6}
        >
          <div className="font-semibold text-slate-50 mb-2 pb-2 border-b border-slate-700/50 text-sm">{title}</div>
          <div className="space-y-3 opacity-95 flex flex-col">{children}</div>
          <Tooltip.Arrow className="fill-slate-900 dark:fill-slate-800" width={12} height={6} />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  </Tooltip.Provider>
);

// Define the available modes
const MODES = [
  {
    id: 'preset1',
    name: 'Voice / Podcast (Keep LRA Above)',
    description: 'Applies highpass, lowpass, and afftdn (noise reduction). Best for speech.',
    preFilters: 'highpass=60,lowpass=16000,afftdn=nr=12:nf=-45',
  },
  {
    id: 'preset2',
    name: 'Music / General (Keep LRA Target)',
    description: 'Applies anlmdn (neural net noise reduction) and biases towards retaining LRA.',
    preFilters: 'anlmdn=s=0.0003',
  },
  {
    id: 'custom',
    name: 'Advanced EBU R128 (Two-Pass Script)',
    description: 'Implements the full loudnorm-two-pass.sh convergence loop without extra pre-filters.',
    preFilters: '',
  }
];

export function AudioProcessor() {
  const [ffmpegLoaded, setFfmpegLoaded] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState('Loading FFmpeg core...');
  const ffmpegRef = useRef<FFmpeg | null>(null);
  
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState(MODES[0].id);
  
  // Params
  const [targetLufs, setTargetLufs] = useState("-14");
  const [targetTp, setTargetTp] = useState("-1.0");
  const [targetLra, setTargetLra] = useState("11");
  const [outputCodec, setOutputCodec] = useState('pcm_s24le'); // pcm_s24le -> wav, libmp3lame -> mp3, flac -> flac
  
  // Advanced Params
  const [linear, setLinear] = useState(true);
  const [dualMono, setDualMono] = useState(false);
  const [converge, setConverge] = useState(false);
  const [verify, setVerify] = useState(false);
  const [lockLra, setLockLra] = useState(false);
  const [nudgeTp, setNudgeTp] = useState(false);
  const [tolLufs, setTolLufs] = useState("0.2");
  const [maxIters, setMaxIters] = useState(4);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [logs, setLogs] = useState<string[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [outputUrl, setOutputUrl] = useState<string | null>(null);
  
  useEffect(() => {
    const load = async () => {
      try {
        const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
        const ffmpeg = new FFmpeg();
        ffmpegRef.current = ffmpeg;
        ffmpeg.on('log', ({ message }) => {
          setLogs(prev => [...prev, message]);
        });
        
        await ffmpeg.load({
          coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
          wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
        });
        setFfmpegLoaded(true);
        setLoadingMsg('');
      } catch (e) {
        setLoadingMsg('Failed to load FFmpeg. Please refresh.');
        console.error(e);
      }
    };
    load();
  }, []);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
      setOutputUrl(null);
      setLogs([]);
    }
  };
  
  const appendLog = (msg: string) => {
    setLogs(prev => [...prev, msg]);
  };

  const getOutputExt = () => {
    if (outputCodec === 'pcm_s24le') return 'wav';
    if (outputCodec === 'flac') return 'flac';
    return 'mp3';
  };

  const selectedMode = MODES.find(m => m.id === mode)!;
  
  // Generate the visual representation of what we are doing
  const generatedCommand = `// Two-Pass EBU R128 Normalization
// Input: ${file ? file.name : 'input.wav'}
// Target: LUFS=${targetLufs}, TP=${targetTp}, LRA=${lockLra ? '[from source]' : targetLra}

// Pass 1: Measure
ffmpeg -y -hide_banner -i ${file ? file.name : 'input.wav'} -af "${selectedMode.preFilters ? selectedMode.preFilters + ',' : + ''}loudnorm=I=${targetLufs}:TP=${targetTp}:LRA=${targetLra}:print_format=json" -f null -

// Pass 2: Apply
ffmpeg  -y -hide_banner -i ${file ? file.name : 'input.wav'} -c:a ${outputCodec} -af "${selectedMode.preFilters ? selectedMode.preFilters + ',' : + ''}loudnorm=I=${targetLufs}:TP=${targetTp}:LRA=${lockLra ? '<measured>' : targetLra}:linear=${linear}:dual_mono=${dualMono}:measured_I=...:measured_LRA=...:measured_TP=...:measured_thresh=...:offset=...:print_format=summary" out.${getOutputExt()}

${(verify || converge) ? '\n// Pass 3+: Verify/Refine based on JSON output' : ''}
`;

  const processAudio = async () => {
    if (!file || !ffmpegLoaded) return;
    
    setIsProcessing(true);
    setLogs([]);
    setOutputUrl(null);
    appendLog('[System] Starting normalization process...');
    
    const ffmpeg = ffmpegRef.current;
    if (!ffmpeg) return;
    
    try {
      // 1. Write file to FFmpeg filesystem
      const inExt = file.name.split('.').pop();
      const inName = `input.${inExt}`;
      const outName = `output.${getOutputExt()}`;
      
      await ffmpeg.writeFile(inName, await fetchFile(file));
      appendLog(`[System] Uploaded ${inName} to virtual filesystem.`);
      
      const preFilterStr = selectedMode.preFilters ? `${selectedMode.preFilters},` : '';
      
      // Values used for Pass 1 and target tracking
      let I_TARGET = parseFloat(targetLufs) || -14;
      let TP_TARGET = parseFloat(targetTp) || -1.0;
      const LRA_TARGET = parseFloat(targetLra) || 11;
      const TOL_LUFS = parseFloat(tolLufs) || 0.2;

      // Pass 1: Measure
      appendLog(`\n[1/3] Measuring: ${inName}`);
      let pass1Logs = '';
      const onPass1Log = ({ message }: { message: string }) => { pass1Logs += message + '\n'; };
      ffmpeg.on('log', onPass1Log);
      
      const pass1Args = [
        '-y', '-hide_banner', '-i', inName,
        '-af', `${preFilterStr}loudnorm=I=${I_TARGET}:TP=${TP_TARGET}:LRA=${LRA_TARGET}:print_format=json`,
        '-f', 'null', '-'
      ];
      await ffmpeg.exec(pass1Args);
      ffmpeg.off('log', onPass1Log);
      
      // Extract JSON from Pass 1
      const jsonMatch = pass1Logs.match(/\{[\s\S]*?\}/);
      if (!jsonMatch) throw new Error("Could not capture pass-1 JSON.");
      let meas = JSON.parse(jsonMatch[0]);
      
      const meas_I = meas.measured_I || meas.input_i;
      const meas_LRA = meas.measured_LRA || meas.input_lra;
      const meas_TP = meas.measured_TP || meas.measured_tp || meas.input_tp;
      const meas_TH = meas.measured_thresh || meas.input_thresh || "";
      const meas_OFF = meas.target_offset || meas.offset || "";

      appendLog(`  pass1: measured_I=${meas_I}, LRA=${meas_LRA}, TP=${meas_TP}, thresh=${meas_TH || '<none>'}, offset=${meas_OFF || '<none>'}`);

      // Choose mode + LRA
      let EFFECTIVE_LINEAR = linear ? "true" : "false";
      if (!meas_TH) EFFECTIVE_LINEAR = "false";
      let LRA_RUN = LRA_TARGET.toString();
      if (lockLra && meas_LRA) LRA_RUN = Math.round(parseFloat(meas_LRA)).toString();

      const build_and_apply = async (passLabel: string) => {
        appendLog(`\n${passLabel} Applying: I=${I_TARGET.toFixed(2)} TP=${TP_TARGET.toFixed(2)} LRA=${LRA_RUN} linear=${EFFECTIVE_LINEAR} dual_mono=${dualMono.toString()}`);
        
        let FILTER = `${preFilterStr}loudnorm=I=${I_TARGET.toFixed(2)}:TP=${TP_TARGET.toFixed(2)}:LRA=${LRA_RUN}:linear=${EFFECTIVE_LINEAR}:dual_mono=${dualMono.toString()}`;
        FILTER += `:measured_I=${meas_I}:measured_LRA=${meas_LRA}:measured_TP=${meas_TP}`;
        if (meas_TH) FILTER += `:measured_thresh=${meas_TH}`;
        if (meas_OFF) FILTER += `:offset=${meas_OFF}`;
        FILTER += `:print_format=summary`;
        
        await ffmpeg.exec([
          '-y', '-hide_banner', '-i', inName,
          '-c:a', outputCodec,
          '-af', FILTER,
          outName
        ]);
      };
      
      // Pass 2: Apply
      await build_and_apply('[2/3]');
      
      // VERIFY & optional convergence
      if (verify || converge) {
        let iters = 0;
        
        while (true) {
          appendLog(`\n[3/3] Verifying (${iters + 1})...`);
          
          let verifyLogs = '';
          const onVerifyLog = ({ message }: { message: string }) => { verifyLogs += message + '\n'; };
          ffmpeg.on('log', onVerifyLog);
          
          await ffmpeg.exec([
            '-y', '-hide_banner', '-i', outName,
            '-af', `loudnorm=I=${I_TARGET.toFixed(2)}:TP=${TP_TARGET.toFixed(2)}:LRA=${LRA_RUN}:print_format=json`,
            '-f', 'null', '-'
          ]);
          ffmpeg.off('log', onVerifyLog);
          
          const vMatch = verifyLogs.match(/\{[\s\S]*?\}/);
          if (!vMatch) {
             appendLog(`  -> [Error] Output file failed verification or missing JSON!`);
             break;
          }
          const vMeas = JSON.parse(vMatch[0]);
          
          const out_I = parseFloat(vMeas.output_i || vMeas.input_i);
          const out_TP = parseFloat(vMeas.output_TP || vMeas.output_tp || vMeas.input_tp);
          const t_off = parseFloat(vMeas.target_offset || "0");
          
          appendLog(`  -> measured_I=${out_I.toFixed(2)} LUFS (Target=${parseFloat(targetLufs).toFixed(2)}, Diff=${(out_I - parseFloat(targetLufs)).toFixed(2)} LU)`);

          if (!converge) break;
          
          // Stop if within tolerance
          if (Math.abs(out_I - parseFloat(targetLufs)) <= TOL_LUFS) {
             appendLog(`  -> Within tolerance (${TOL_LUFS} LUFS). Convergence complete!`);
             break;
          }
          
          // Optional TP nudge
          if (nudgeTp) {
             const tp_gap = TP_TARGET - out_TP; 
             if (tp_gap > 0.7) {
                appendLog(`  -> note: output TP well below ceiling; relaxing TP target to -0.8 dBTP once.`);
                TP_TARGET = -0.8;
             }
          }
          
          const new_I = parseFloat((I_TARGET + t_off).toFixed(2));
          appendLog(`  -> converge: I_target ${I_TARGET.toFixed(2)} -> ${new_I.toFixed(2)} (offset ${t_off.toFixed(2)})`);
          I_TARGET = new_I;
          
          // Re-run pass 2
          await build_and_apply(`[Refine ${iters + 1}]`);

          iters++;
          if (iters >= maxIters) {
             appendLog(`  -> Reached max iterations (${maxIters}).`);
             break;
          }
        }
      }

      // Always perform a final reading to output English format logging
      let finalLogs = '';
      const onFinalLog = ({ message }: { message: string }) => { finalLogs += message + '\n'; };
      ffmpeg.on('log', onFinalLog);
      
      await ffmpeg.exec([
        '-y', '-hide_banner', '-i', outName,
        '-af', `loudnorm=I=${parseFloat(targetLufs)}:TP=${parseFloat(targetTp)}:LRA=${parseFloat(targetLra)}:print_format=json`,
        '-f', 'null', '-'
      ]);
      ffmpeg.off('log', onFinalLog);
      
      const finalMatch = finalLogs.match(/\{[\s\S]*?\}/);
      if (finalMatch) {
         try {
           const fMeas = JSON.parse(finalMatch[0]);
           
           if (verify) {
             appendLog(`  -> Verification JSON:\n${JSON.stringify(fMeas, null, 2)}`);
           }

           appendLog(`\nFinal output:
Input Integrated:    ${meas.input_i} LUFS
Input True Peak:      ${meas.input_tp} dBTP
Input LRA:             ${meas.input_lra} LU
Input Threshold:     ${meas.input_thresh || 'N/A'} LUFS
Output Integrated:   ${fMeas.input_i || fMeas.output_i || '0.0'} LUFS
Output True Peak:     ${fMeas.input_tp || fMeas.output_tp || fMeas.output_TP || '0.0'} dBTP
Output LRA:            ${fMeas.input_lra || fMeas.output_lra || '0.0'} LU
Output Threshold:    ${fMeas.input_thresh || fMeas.output_thresh || 'N/A'} LUFS
Normalization Type:   ${linear ? 'Linear' : 'Dynamic'}
Target Offset:        ${meas.target_offset || '0.0'} LU`);
         } catch (e) {
           appendLog(`\n[System] Note: Could not parse final English summary.`);
         }
      }

      // Read final output
      const data = await ffmpeg.readFile(outName);
      const blob = new Blob([new Uint8Array(data as any)], { type: 'audio/' + getOutputExt() });
      const url = URL.createObjectURL(blob);
      setOutputUrl(url);
      appendLog('\n[System] File processed successfully! Ready for download.');
      
    } catch (e: any) {
      appendLog(`\n[Error] ${e.message}`);
      console.error(e);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto py-12 px-4 sm:px-6 lg:px-8 font-sans">
      <div className="flex items-center gap-3 mb-8">
        <div className="h-10 w-10 bg-indigo-600 dark:bg-indigo-500 rounded-xl flex items-center justify-center text-white">
          <Settings2 className="w-5 h-5" />
        </div>
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-100">Audio Normalizer</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">In-browser two-pass FFmpeg EBU R128</p>
        </div>
      </div>

      {!ffmpegLoaded ? (
        <div className="flex flex-col items-center justify-center py-20 bg-slate-50 dark:bg-slate-900/50 rounded-2xl border border-slate-200 dark:border-slate-800">
          <Loader2 className="w-8 h-8 text-indigo-600 dark:text-indigo-400 animate-spin mb-4" />
          <p className="text-slate-600 dark:text-slate-400 font-medium">{loadingMsg}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          
          {/* LEFT COLUMN: CONTROLS */}
          <div className="lg:col-span-4 space-y-6">
            
            {/* Upload Area */}
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-1">
              <label className="flex flex-col items-center justify-center w-full h-40 rounded-xl border-2 border-dashed border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer transition-colors">
                <input type="file" className="hidden" accept="audio/*" onChange={handleFileUpload} />
                <div className="flex flex-col items-center justify-center pt-5 pb-6">
                   {file ? (
                     <>
                       <FileAudio className="w-10 h-10 mb-3 text-indigo-600 dark:text-indigo-400" />
                       <p className="mb-2 text-sm font-semibold text-slate-900 dark:text-slate-100">{file.name}</p>
                       <p className="text-xs text-slate-500 dark:text-slate-400">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                     </>
                   ) : (
                     <>
                       <Upload className="w-10 h-10 mb-3 text-slate-400 dark:text-slate-500" />
                       <p className="mb-2 text-sm text-slate-600 dark:text-slate-400"><span className="font-semibold">Click to upload</span> or drag and drop</p>
                       <p className="text-xs text-slate-500 dark:text-slate-500">WAV, FLAC, MP3</p>
                     </>
                   )}
                </div>
              </label>
            </div>

            {/* Settings Card */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2 mb-6">
                <Settings2 className="w-4 h-4 text-slate-500 dark:text-slate-400" /> Validation Parameters
              </h2>
              
              <div className="space-y-5">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Processing Preset</label>
                  <select 
                    value={mode}
                    onChange={e => setMode(e.target.value)}
                    className="w-full rounded-lg border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                  >
                    {MODES.map(m => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </select>
                  <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">{selectedMode.description}</p>
                </div>

                <div className="grid grid-cols-2 gap-4 pt-4 border-t border-slate-100 dark:border-slate-800">
                  <div>
                    <div className="flex items-center mb-1">
                      <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Target LUFS</label>
                      <InfoTooltip title="LUFS: Loudness Units Full Scale">
                        <p><strong>LUFS</strong> measures the perceived loudness of your audio, taking into account how the human ear hears sound. Unlike older meters that measure a signal&apos;s electrical level (like RMS) or its highest peak, LUFS uses a standardized algorithm that weights certain frequencies to more accurately reflect our hearing.</p>
                        <p><strong>Integrated LUFS:</strong> This is the average loudness of an entire track from beginning to end. Most streaming platforms (Spotify, Apple Music, YouTube) use this value for loudness normalization, turning down tracks that are too loud to a standardized level (e.g., -14 LUFS).</p>
                        <p><strong>Momentary and Short-Term LUFS:</strong> These measure the loudness of audio over shorter windows (momentary: 400ms; short-term: 3 seconds). They are useful for checking how the loudness of your track varies from one section to another.</p>
                      </InfoTooltip>
                    </div>
                    <input 
                      type="text" 
                      value={targetLufs}
                      onChange={e => setTargetLufs(e.target.value)}
                      className="w-full rounded-lg border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                    />
                  </div>
                  <div>
                    <div className="flex items-center mb-1">
                      <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">True Peak (dBTP)</label>
                      <InfoTooltip title="True Peak">
                        <p><strong>True Peak</strong> measures the actual highest peak level that a waveform will reach during playback. A standard peak meter in your DAW only measures the highest digital sample points, but the process of digital-to-analog conversion can create &quot;inter-sample peaks&quot; that exceed 0 dBFS and cause audible distortion.</p>
                        <p><strong>dBTP:</strong> True Peak measurements are displayed in dBTP (decibels True Peak).</p>
                        <p><strong>The Overshoot Problem:</strong> A True Peak meter uses oversampling to accurately predict these hidden peaks, ensuring your audio doesn&apos;t clip when played back on a listener&apos;s device.</p>
                        <p><strong>In mastering:</strong> to avoid distortion from inter-sample peaks, it&apos;s standard practice to set your mastering limiter&apos;s output ceiling so that the True Peak level never exceeds -1.0 dBTP. Many streaming platforms even have a -1.0 dBTP limit as a standard requirement.</p>
                      </InfoTooltip>
                    </div>
                    <input 
                      type="text" 
                      value={targetTp}
                      onChange={e => setTargetTp(e.target.value)}
                      className="w-full rounded-lg border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                    />
                  </div>
                </div>

                <div>
                  <div className="flex items-center mb-1">
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Loudness Range (LRA)</label>
                    <InfoTooltip title="Loudness Range (LRA)">
                      <p><strong>LRA</strong> measures the statistical loudness variation within a track, indicating the difference between its quietest and loudest sections. It provides a long-term measure of your track&apos;s overall dynamic movement, ignoring the quietest passages.</p>
                      <p><strong>High vs. Low LRA:</strong> A high LRA value (e.g., 15 LU) indicates a track with a wide dynamic range, like a classical score. A low LRA value (e.g., 3 LU) signifies a track with a very narrow dynamic range, like a heavily compressed pop or electronic track.</p>
                      <p><strong>In mastering:</strong> LRA is not a metric with a specific target but rather an indicator of creative intent. A mastering engineer uses LRA to understand the overall dynamic arc of a piece of music and ensure it aligns with the genre and artistic vision.</p>
                    </InfoTooltip>
                  </div>
                  <input 
                    type="text" 
                    value={targetLra}
                    disabled={lockLra}
                    onChange={e => setTargetLra(e.target.value)}
                    className={`w-full rounded-lg shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm ${lockLra ? 'bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-400 dark:text-slate-500' : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100'}`}
                  />
                </div>
                
                <div className="pt-4 border-t border-slate-100 dark:border-slate-800 group">
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Output Codec</label>
                  <select 
                    value={outputCodec}
                    onChange={e => setOutputCodec(e.target.value)}
                    className="w-full rounded-lg border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                  >
                    <option value="pcm_s24le">WAV (24-bit PCM)</option>
                    <option value="flac">FLAC</option>
                    <option value="libmp3lame">MP3</option>
                  </select>
                </div>
                
                <div className="pt-4 border-t border-slate-100 dark:border-slate-800">
                  <button 
                    onClick={() => setShowAdvanced(!showAdvanced)} 
                    className="w-full flex items-center justify-between py-2 text-sm font-semibold text-slate-800 dark:text-slate-200 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors focus:outline-none"
                  >
                    <span>Advanced Parameters</span>
                    <ChevronDown className={`w-4 h-4 text-slate-500 dark:text-slate-400 transition-transform duration-200 ${showAdvanced ? 'rotate-180' : ''}`} />
                  </button>
                  
                  <motion.div 
                    initial={false}
                    animate={{ height: showAdvanced ? "auto" : 0, opacity: showAdvanced ? 1 : 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <div className="pt-4 grid grid-cols-2 gap-y-3 gap-x-4">
                       
                       <div className="flex items-center">
                         <label className="flex items-center gap-2 cursor-pointer">
                           <input type="checkbox" checked={linear} onChange={e => setLinear(e.target.checked)} className="rounded border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-950 text-indigo-600 dark:text-indigo-400 focus:ring-indigo-600 w-4 h-4" />
                           <span className="text-sm text-slate-700 dark:text-slate-300">Linear</span>
                         </label>
                         <InfoTooltip title="Linear"><p>Prefers the slower, two-pass linear mode when evaluating true peak/loudness (true by default).</p></InfoTooltip>
                       </div>
                       
                       <div className="flex items-center">
                         <label className="flex items-center gap-2 cursor-pointer">
                           <input type="checkbox" checked={dualMono} onChange={e => setDualMono(e.target.checked)} className="rounded border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-950 text-indigo-600 dark:text-indigo-400 focus:ring-indigo-600 w-4 h-4" />
                           <span className="text-sm text-slate-700 dark:text-slate-300">Dual Mono</span>
                         </label>
                         <InfoTooltip title="Dual Mono"><p>Enables the dual mono configuration inside the filter.</p></InfoTooltip>
                       </div>
                       
                       <div className="flex items-center">
                         <label className="flex items-center gap-2 cursor-pointer">
                           <input type="checkbox" checked={converge} onChange={e => setConverge(e.target.checked)} className="rounded border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-950 text-indigo-600 dark:text-indigo-400 focus:ring-indigo-600 w-4 h-4" />
                           <span className="text-sm text-slate-700 dark:text-slate-300">Converge</span>
                         </label>
                         <InfoTooltip title="Converge"><p>Iterate until LUFS within tol</p></InfoTooltip>
                       </div>
  
                       <div className="flex items-center">
                         <label className="flex items-center gap-2 cursor-pointer">
                           <input type="checkbox" checked={verify} onChange={e => setVerify(e.target.checked)} className="rounded border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-950 text-indigo-600 dark:text-indigo-400 focus:ring-indigo-600 w-4 h-4" />
                           <span className="text-sm text-slate-700 dark:text-slate-300">Verify</span>
                         </label>
                         <InfoTooltip title="Verify"><p>Print verify JSON after pass</p></InfoTooltip>
                       </div>
  
                       <div className="flex items-center">
                         <label className="flex items-center gap-2 cursor-pointer">
                           <input type="checkbox" checked={lockLra} onChange={e => setLockLra(e.target.checked)} className="rounded border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-950 text-indigo-600 dark:text-indigo-400 focus:ring-indigo-600 w-4 h-4" />
                           <span className="text-sm text-slate-700 dark:text-slate-300">Lock LRA</span>
                         </label>
                         <InfoTooltip title="Lock LRA"><p>Lock to source LRA</p></InfoTooltip>
                       </div>
  
                       <div className="flex items-center">
                         <label className="flex items-center gap-2 cursor-pointer">
                           <input type="checkbox" checked={nudgeTp} onChange={e => setNudgeTp(e.target.checked)} className="rounded border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-950 text-indigo-600 dark:text-indigo-400 focus:ring-indigo-600 w-4 h-4" />
                           <span className="text-sm text-slate-700 dark:text-slate-300">Nudge TP</span>
                         </label>
                         <InfoTooltip title="Nudge TP"><p>If TP ≪ target, relax to -0.8 once</p></InfoTooltip>
                       </div>
                    </div>
                    
                    <div className="mt-4 flex items-center justify-between pb-1">
                      <label className="text-sm font-medium text-slate-700 dark:text-slate-300 flex items-center">
                        LUFS Tolerance
                        <InfoTooltip title="LUFS Tolerance"><p>Tolerance for convergence (abs LUFS diff)</p></InfoTooltip>
                      </label>
                      <input 
                        type="text" 
                        value={tolLufs} 
                        onChange={e => setTolLufs(e.target.value)} 
                        disabled={!converge}
                        className={`w-20 rounded-lg shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm text-right ${!converge ? 'bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-400 dark:text-slate-500' : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100'}`} 
                      />
                    </div>
                    
                    <div className="mt-3 flex items-center justify-between pb-1">
                      <label className="text-sm font-medium text-slate-700 dark:text-slate-300 flex items-center">
                        Max Iterations
                        <InfoTooltip title="Max Iterations"><p>Max convergence iterations</p></InfoTooltip>
                      </label>
                      <input 
                        type="number" 
                        step="1" 
                        min="1" 
                        max="10" 
                        value={maxIters} 
                        onChange={e => setMaxIters(parseInt(e.target.value))} 
                        disabled={!converge}
                        className={`w-20 rounded-lg shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm text-right ${!converge ? 'bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-400 dark:text-slate-500' : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100'}`} 
                      />
                    </div>
                  </motion.div>
                </div>

              </div>
            </div>
            
            <button
              onClick={processAudio}
              disabled={!file || isProcessing}
              className="w-full flex items-center justify-center gap-2 bg-indigo-600 dark:bg-indigo-500 hover:bg-indigo-700 dark:hover:bg-indigo-600 disabled:bg-slate-300 dark:disabled:bg-slate-800 transition-colors text-white font-medium py-3.5 px-4 rounded-xl shadow-sm"
            >
              {isProcessing ? (
                <><RefreshCw className="w-5 h-5 animate-spin" /> Processing...</>
              ) : (
                <><Play className="w-5 h-5 fill-current" /> Run Normalization</>
              )}
            </button>
            
            {outputUrl && (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="p-4 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/50 rounded-xl"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 text-emerald-800 dark:text-emerald-400">
                    <div className="bg-emerald-100 dark:bg-emerald-900/50 p-2 rounded-lg">
                      <FileAudio className="w-5 h-5" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold">Ready</p>
                      <p className="text-xs text-emerald-600/80 dark:text-emerald-400/80">output.{getOutputExt()}</p>
                    </div>
                  </div>
                  <a 
                    href={outputUrl} 
                    download={`output.${getOutputExt()}`}
                    className="flex items-center gap-2 bg-emerald-600 dark:bg-emerald-500 hover:bg-emerald-700 dark:hover:bg-emerald-600 text-white text-sm font-medium py-2 px-4 rounded-lg shadow-sm transition-colors"
                  >
                    <Download className="w-4 h-4" /> Download
                  </a>
                </div>
              </motion.div>
            )}

          </div>

          {/* RIGHT COLUMN: PREVIEW AND LOGS */}
          <div className="lg:col-span-8 flex flex-col gap-6">
            
            {/* Code Preview */}
            <div className="bg-slate-900 dark:bg-black rounded-2xl overflow-hidden shadow-sm border border-slate-800 dark:border-slate-800/50">
              <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 dark:border-slate-800/50 bg-slate-900/50 dark:bg-slate-900/30">
                <div className="flex items-center gap-2 text-slate-400">
                  <FileTerminal className="w-4 h-4" />
                  <span className="text-xs font-medium font-mono uppercase tracking-wider">Command Preview</span>
                </div>
              </div>
              <div className="p-4 bg-slate-900 dark:bg-black overflow-x-auto">
                <pre className="text-sm font-mono text-slate-300 dark:text-slate-400 leading-relaxed whitespace-pre-wrap">
                  {generatedCommand}
                </pre>
              </div>
            </div>

            {/* Execution Logs */}
            <div className="flex-1 bg-black rounded-2xl overflow-hidden shadow-sm border border-slate-800 dark:border-slate-800/50 flex flex-col min-h-[400px]">
              <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 dark:border-slate-800/50 bg-slate-900/50 dark:bg-slate-900/30 shrink-0">
                <div className="flex items-center gap-2 text-slate-400">
                  <ArrowRight className="w-4 h-4" />
                  <span className="text-xs font-medium font-mono uppercase tracking-wider">Execution Log</span>
                </div>
                {isProcessing && (
                  <span className="flex items-center gap-2 text-xs font-medium text-emerald-400 bg-emerald-400/10 px-2 py-1 rounded-md">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span> Running
                  </span>
                )}
              </div>
              <div className="p-4 bg-black overflow-y-auto flex-1 font-mono text-xs text-slate-400 dark:text-slate-500 leading-relaxed max-h-[500px]">
                {logs.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-slate-600">
                     Awaiting execution...
                  </div>
                ) : (
                  logs.map((log, i) => (
                    <div key={i} className="whitespace-pre-wrap break-words">{log}</div>
                  ))
                )}
              </div>
            </div>

          </div>
        </div>
      )}
    </div>
  );
}
