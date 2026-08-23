export default function Hero() {
  return (
    <section className="relative py-16 sm:py-24 lg:py-32 overflow-hidden">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-3xl mx-auto">
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-foreground tracking-tight text-pretty motion-safe:animate-[fadeInUp_400ms_ease-out] motion-reduce:animate-none">
            Bid to Lead. <span className="text-primary">Win the Spotlight.</span>
          </h1>
          <p className="mt-6 text-lg sm:text-xl text-muted-foreground max-w-2xl mx-auto text-pretty motion-safe:animate-[fadeInUp_400ms_ease-out_100ms_both] motion-reduce:animate-none">
            Pick a category. Place your bid. Become the #1. Real-time leaderboards, instant outbid
            notifications, and viral share moments.
          </p>
          <div className="mt-10 flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3 sm:gap-4 motion-safe:animate-[fadeInUp_400ms_ease-out_200ms_both] motion-reduce:animate-none">
            <a
              href="/categories"
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-6 py-3.5 text-primary-foreground font-medium text-base transition-all will-change-transform hover:-translate-y-px hover:shadow-md active:translate-y-0 active:shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 w-full sm:w-auto min-h-11 motion-reduce:transform-none motion-reduce:shadow-none"
            >
              Start Bidding
            </a>
            <a
              href="/leaderboard"
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-background px-6 py-3.5 text-foreground font-medium text-base transition-all hover:bg-muted hover:border-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 w-full sm:w-auto min-h-11"
            >
              View Leaderboard
            </a>
          </div>
        </div>

        <div className="mt-16 relative">
          <div
            className="absolute inset-0 bg-gradient-to-t from-background via-transparent to-transparent z-10 pointer-events-none"
            aria-hidden="true"
          />
          <div className="rounded-xl border border-border bg-muted/50 p-4 sm:p-8 max-w-4xl mx-auto">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 sm:gap-8 text-center">
              <div className="p-4 sm:p-6">
                <div className="text-3xl sm:text-4xl font-bold text-foreground">$0</div>
                <div className="mt-1 text-sm text-muted-foreground">Starting Bid</div>
              </div>
              <div className="p-4 sm:p-6 border-x border-border sm:border-x-0 sm:border-y">
                <div className="text-3xl sm:text-4xl font-bold text-primary">#1</div>
                <div className="mt-1 text-sm text-muted-foreground">Top Position</div>
              </div>
              <div className="p-4 sm:p-6">
                <div className="text-3xl sm:text-4xl font-bold text-success">Live</div>
                <div className="mt-1 text-sm text-muted-foreground">Real-time Updates</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
