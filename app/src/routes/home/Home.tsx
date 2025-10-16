export default function Home() {
  return (
    <main className="min-h-[100dvh]">
      {/* Hero section with video background */}
      <section className="relative h-[calc(100dvh-56px)]"> {/* 56px ≈ h-14 navbar */}
        {/* background video */}
        <video
          className="absolute inset-0 h-full w-full object-cover"
          src="/images/home-video.mp4"
          autoPlay
          loop
          muted
          playsInline
        />
        {/* black overlay */}
        <div className="absolute inset-0 bg-black/40" />
        {/* centered logo/content */}
        <div className="relative z-10 h-full w-full grid place-items-center">
          <div className="flex flex-col items-center gap-6">
            <img
              src="/images/taedal-home.svg"
              alt="taedal"
              className="w-[150px] md:w-[350px]
              translate-y-8 md:translate-y-16
               drop-shadow-[0_4px_40px_rgba(0,0,0,0.6)]"
            />
          </div>
        </div>
      </section>
    </main>
  );
}
