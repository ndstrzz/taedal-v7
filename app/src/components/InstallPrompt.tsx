import React from "react";

type Props = {
  onContinue: () => void;
};

export default function InstallPrompt({ onContinue }: Props) {
  return (
    <div className="min-h-screen w-full bg-black text-white flex items-center justify-center px-6">
      <div className="w-full max-w-sm rounded-3xl border border-white/10 bg-white/[0.04] p-5 space-y-5">
        <div className="text-xs uppercase tracking-[0.2em] text-white/40">
          Taedal · Mobile Web
        </div>

        <div className="space-y-2">
          <h1 className="text-xl font-semibold leading-tight">
            Our Taedal web has a mobile version
          </h1>
          <p className="text-sm text-white/70">
            To improve your mobile experience, please{" "}
            <span className="font-medium">press the Share button</span>{" "}
            and then choose{" "}
            <span className="font-medium">“Add to Home Screen”.</span>
          </p>
        </div>

        {/* iOS instructions */}
        <div className="space-y-2 text-xs bg-white/[0.03] border border-white/10 rounded-2xl p-3">
          <div className="font-medium text-white/80">On iPhone (Safari)</div>
          <ol className="list-decimal list-inside space-y-1 text-white/70">
            <li>Tap the <span className="font-medium">Share</span> button in Safari.</li>
            <li>Select <span className="font-medium">Add to Home Screen</span>.</li>
          </ol>
        </div>

        {/* Android instructions */}
        <div className="space-y-2 text-xs bg-white/[0.03] border border-white/10 rounded-2xl p-3">
          <div className="font-medium text-white/80">On Android (Chrome)</div>
          <ol className="list-decimal list-inside space-y-1 text-white/70">
            <li>Tap the <span className="font-medium">⋮</span> menu in the top-right.</li>
            <li>Choose <span className="font-medium">Add to Home screen</span>.</li>
          </ol>
        </div>

        <p className="text-[11px] text-white/50">
          This step is optional, but adding Taedal to your home screen makes it
          feel more like a dedicated app with a smoother experience.
        </p>

        <button
          type="button"
          onClick={onContinue}
          className="btn w-full mt-1"
        >
          I&apos;ve added it / Continue
        </button>
      </div>
    </div>
  );
}
