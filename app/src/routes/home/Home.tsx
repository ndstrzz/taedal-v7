// app/src/routes/home/Home.tsx
export default function Home() {
  return (
    <main className="min-h-[100dvh]">
      {/* Hero with video background */}
      <section className="relative h-[calc(100dvh-56px)] overflow-hidden">
        {/* background video */}
        <video
          className="absolute inset-0 h-full w-full object-cover"
          src="/images/home-video.mp4"
          autoPlay
          loop
          muted
          playsInline
        />
        {/* subtle vignette to balance contrast */}
        <div className="absolute inset-0 bg-gradient-to-r from-black/55 via-black/30 to-black/55 pointer-events-none" />

        {/* Content: center on mobile, shift right on large screens */}
        <div className="relative z-10 h-full">
          <div className="mx-auto h-full max-w-[1500px] px-4 sm:px-6 lg:px-10">
            <div
              className="
                h-full w-full flex items-center
                justify-center
                lg:justify-end lg:pr-[37vw]   /* push logo a bit to the right on desktop */
              "
            >
              <img
                src="/images/taedal-home.svg"
                alt="taedal"
                className="
                  w-[150px] sm:w-[050px] lg:w-[160px] xl:w-[180px]  /* smaller scale */
                  drop-shadow-[0_6px_40px_rgba(0,0,0,0.6)]
                "
              />
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
