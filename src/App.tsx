import { AudioProcessor } from '@/components/audio-processor';
import { ModeToggle } from '@/components/mode-toggle';

export default function App() {
  return (
    <main className="min-h-screen bg-slate-50 dark:bg-slate-950 transition-colors duration-200">
      <div className="absolute top-4 right-4 z-50">
        <ModeToggle />
      </div>
      <AudioProcessor />
    </main>
  );
}
