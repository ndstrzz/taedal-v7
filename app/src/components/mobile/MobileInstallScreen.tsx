type MobileInstallScreenProps = {
  onDismiss: () => void;
};

export function MobileInstallScreen({ onDismiss }: MobileInstallScreenProps) {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-50 flex flex-col">
      {/* Top area */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-10">
        <div className="mb-6 flex items-center gap-3">
          <div className="h-10 w-10 rounded-2xl bg-slate-800 flex items-center justify-center text-xl font-semibold">
            T
          </div>
          <div className="flex flex-col">
            <span className="text-sm uppercase tracking-[0.2em] text-slate-400">
              Taedal mobile
            </span>
            <span className="text-lg font-semibold text-slate-50">
              Add Taedal to your Home Screen
            </span>
          </div>
        </div>

        <p className="text-sm text-slate-300 text-center max-w-md mb-6">
          For the best experience on your iPhone, add Taedal to your Home
          Screen. It will open full-screen and feel just like an app.
        </p>

        {/* Fake phone card with steps */}
        <div className="w-full max-w-xs rounded-3xl border border-slate-800 bg-slate-900/70 px-5 py-6 shadow-lg">
          <p className="text-xs font-medium text-slate-400 mb-4">
            On Safari:
          </p>

          <ol className="space-y-3 text-xs text-slate-200">
            <li className="flex items-start gap-2">
              <span className="mt-[2px] inline-flex h-5 w-5 items-center justify-center rounded-full bg-slate-800 text-[11px]">
                1
              </span>
              <span>
                Tap the{" "}
                <span className="font-semibold">Share</span> button at the
                bottom of the screen
                <span className="text-slate-400"> (box with an arrow)</span>.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-[2px] inline-flex h-5 w-5 items-center justify-center rounded-full bg-slate-800 text-[11px]">
                2
              </span>
              <span>
                Scroll down and tap{" "}
                <span className="font-semibold">“Add to Home Screen”</span>.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-[2px] inline-flex h-5 w-5 items-center justify-center rounded-full bg-slate-800 text-[11px]">
                3
              </span>
              <span>
                Tap <span className="font-semibold">“Add”</span> in the top-right
                corner.
              </span>
            </li>
          </ol>

          <p className="mt-4 text-[11px] text-slate-400">
            After that, launch Taedal from your Home Screen icon for a smoother,
            app-like experience.
          </p>
        </div>
      </div>

      {/* Bottom buttons */}
      <div className="px-6 pb-8 flex flex-col gap-3">
        <button
          type="button"
          className="w-full rounded-full bg-slate-100 text-slate-950 text-sm font-semibold py-3"
          onClick={onDismiss}
        >
          I’ve added it
        </button>
        <button
          type="button"
          className="w-full rounded-full border border-slate-700 text-slate-300 text-xs py-2"
          onClick={onDismiss}
        >
          Skip for now
        </button>
      </div>
    </div>
  );
}
