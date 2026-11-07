// The signed-out landing page: "Study Booth" lights up bulb by bulb on a
// marquee board, then the tagline, a few feature chips and the entry card float in.
// The title is a canvas (MarqueeTitle); the rest is CSS (see "landing" in
// globals.css). Both switch off with prefers-reduced-motion.

import MarqueeTitle from "@/components/MarqueeTitle";

const FEATURES = ["Fog-glass doodles", "Handwritten card notes", "Scratch to reveal", "Floating study widget"];

export default function Landing({ notice }: { notice: React.ReactNode }) {
  return (
    <main className="landing">
      <div className="landing-bubbles" aria-hidden="true">
        {Array.from({ length: 9 }, (_, i) => (
          <span key={i} className={`bubble bubble-${i}`} />
        ))}
      </div>

      <h1 className="landing-title">
        <span className="sr-only">Study Booth</span>
        <MarqueeTitle />
      </h1>

      <p className="landing-tagline">Study apart, together.</p>
      <p className="landing-blurb">
        Share tiny handmade photos and notes with your study friends. They arrive under silver foil, and friends scratch to reveal them.
      </p>
      <ul className="landing-features" aria-label="Features">
        {FEATURES.map((f, i) => (
          <li key={f} style={{ animationDelay: `${3.1 + i * 0.12}s` }}>
            {f}
          </li>
        ))}
      </ul>

      <div className="landing-auth">{notice}</div>
    </main>
  );
}
