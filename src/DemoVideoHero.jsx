import { useState, useRef } from "react";

/**
 * Shield AI — Homepage demo video hero.
 *
 * Drop-in React component for the React/Vite app.
 * - Responsive 16:9 video container (no layout shift on load)
 * - Poster frame with a custom play overlay (defers video load until click)
 * - Dual CTA: primary "Book a demo" + secondary "Start free trial"
 *
 * Usage:
 *   <DemoVideoHero
 *     videoSrc="/media/shieldai-demo.mp4"
 *     posterSrc="/media/shieldai-poster.jpg"
 *     onBookDemo={() => navigate("/demo")}
 *     onStartTrial={() => navigate("/signup")}
 *   />
 *
 * Colors match the Shield AI brand scheme (navy #0F1E3D / accent #2E5EAA).
 */
export default function DemoVideoHero({
  videoSrc = "/media/shieldai-demo.mp4",
  posterSrc = "/media/shieldai-poster.jpg",
  captionsSrc, // optional WebVTT track for accessibility
  onBookDemo,
  onStartTrial,
}) {
  const [playing, setPlaying] = useState(false);
  const videoRef = useRef(null);

  const handlePlay = () => {
    setPlaying(true);
    // Video element mounts on play; kick it off once it's in the DOM.
    requestAnimationFrame(() => {
      const v = videoRef.current;
      if (v) v.play().catch(() => {});
    });
  };

  return (
    <section style={styles.hero} aria-label="Shield AI product demo">
      <div style={styles.inner}>
        <p style={styles.eyebrow}>Your AI-powered virtual CISO</p>
        <h1 style={styles.heading}>
          Enterprise-grade security,
          <br />
          <span style={styles.headingAccent}>priced for the businesses that need it most.</span>
        </h1>
        <p style={styles.subhead}>
          Shield AI runs your entire security program automatically — one clear posture
          score, plain-English alerts, and continuous mapping to NIST, CMMC, ISO 27001,
          and FedRAMP.
        </p>

        {/* Video */}
        <div style={styles.videoFrame}>
          <div style={styles.videoRatio}>
            {playing ? (
              <video
                ref={videoRef}
                style={styles.video}
                src={videoSrc}
                poster={posterSrc}
                controls
                playsInline
                preload="auto"
              >
                {captionsSrc && (
                  <track
                    kind="captions"
                    src={captionsSrc}
                    srcLang="en"
                    label="English"
                    default
                  />
                )}
              </video>
            ) : (
              <button
                type="button"
                onClick={handlePlay}
                style={{ ...styles.poster, backgroundImage: `url(${posterSrc})` }}
                aria-label="Play the Shield AI demo video"
              >
                <span style={styles.playScrim} aria-hidden="true" />
                <span style={styles.playButton} aria-hidden="true">
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="#FFFFFF">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </span>
                <span style={styles.playLabel}>Watch the 90-second demo</span>
              </button>
            )}
          </div>
        </div>

        {/* Dual CTA */}
        <div style={styles.ctaRow}>
          <button type="button" style={styles.ctaPrimary} onClick={onBookDemo}>
            Book a demo
          </button>
          <button type="button" style={styles.ctaSecondary} onClick={onStartTrial}>
            Start free trial
          </button>
        </div>
        <p style={styles.trust}>Built by a former U.S. Navy officer • No credit card required</p>
      </div>
    </section>
  );
}

const NAVY = "#0F1E3D";
const NAVY_2 = "#16294D";
const ACCENT = "#2E5EAA";
const ACCENT_HI = "#3E7BD1";
const TAGLINE = "#9EC1EE";

const styles = {
  hero: {
    background: NAVY,
    color: "#FFFFFF",
    padding: "clamp(2.5rem, 6vw, 5rem) 1.25rem",
    fontFamily:
      "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  },
  inner: { maxWidth: 960, margin: "0 auto", textAlign: "center" },
  eyebrow: {
    color: TAGLINE,
    fontSize: 14,
    fontWeight: 600,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    margin: "0 0 1rem",
  },
  heading: {
    fontSize: "clamp(1.9rem, 4.5vw, 3rem)",
    fontWeight: 700,
    lineHeight: 1.15,
    margin: "0 0 1.25rem",
  },
  headingAccent: { color: TAGLINE },
  subhead: {
    fontSize: "clamp(1rem, 1.6vw, 1.15rem)",
    lineHeight: 1.6,
    color: "#C7D6EC",
    maxWidth: 680,
    margin: "0 auto 2.25rem",
  },
  videoFrame: {
    borderRadius: 16,
    padding: 8,
    background: NAVY_2,
    border: `1px solid ${ACCENT}`,
    boxShadow: "0 20px 60px rgba(0,0,0,0.45)",
    margin: "0 auto 2rem",
    maxWidth: 860,
  },
  videoRatio: {
    position: "relative",
    width: "100%",
    aspectRatio: "16 / 9",
    borderRadius: 10,
    overflow: "hidden",
    background: "#000",
  },
  video: {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    objectFit: "cover",
    display: "block",
  },
  poster: {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    border: "none",
    padding: 0,
    cursor: "pointer",
    backgroundSize: "cover",
    backgroundPosition: "center",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
  },
  playScrim: {
    position: "absolute",
    inset: 0,
    background: "rgba(15,30,61,0.35)",
  },
  playButton: {
    position: "relative",
    width: 72,
    height: 72,
    borderRadius: "50%",
    background: ACCENT,
    border: `2px solid ${ACCENT_HI}`,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    paddingLeft: 4,
    boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
  },
  playLabel: {
    position: "relative",
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: 600,
    letterSpacing: "0.02em",
    textShadow: "0 1px 3px rgba(0,0,0,0.6)",
  },
  ctaRow: {
    display: "flex",
    gap: 12,
    justifyContent: "center",
    flexWrap: "wrap",
    margin: "0 0 1rem",
  },
  ctaPrimary: {
    background: ACCENT,
    color: "#FFFFFF",
    border: "none",
    borderRadius: 8,
    padding: "14px 28px",
    fontSize: 16,
    fontWeight: 600,
    cursor: "pointer",
  },
  ctaSecondary: {
    background: "transparent",
    color: "#FFFFFF",
    border: `1px solid ${ACCENT_HI}`,
    borderRadius: 8,
    padding: "14px 28px",
    fontSize: 16,
    fontWeight: 600,
    cursor: "pointer",
  },
  trust: { color: "#8FA6C6", fontSize: 13, margin: 0 },
};
