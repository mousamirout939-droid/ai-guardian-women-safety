import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ShieldCheck, Radio, Hand, Mic, ScanEye, Route, ArrowRight } from "lucide-react";
import { AuroraBackground } from "@/components/AuroraBackground";

const MODULES = [
  {
    icon: Hand,
    title: "Gesture recognition",
    copy: "Raise a closed fist with a tucked thumb toward the camera and the system reads it as a silent call for help — no sound, no unlock code.",
  },
  {
    icon: Mic,
    title: "Scream & speech detection",
    copy: "Audio models listen for the acoustic signature of distress and for spoken words like \"help\" or \"stop,\" even with the screen off.",
  },
  {
    icon: ScanEye,
    title: "Object & threat detection",
    copy: "Live computer vision flags weapons, crowding, and vehicles nearby, so context — not just a single frame — drives the alert.",
  },
  {
    icon: Radio,
    title: "Risk prediction",
    copy: "A trained model weighs time of day, lighting, nearby incident history, and weather into one clear risk score before anything happens.",
  },
  {
    icon: Route,
    title: "Safer routes",
    copy: "Route suggestions lean away from historically higher-risk blocks, favoring lit, populated paths over the shortest line.",
  },
  {
    icon: ShieldCheck,
    title: "Trusted network",
    copy: "One tap notifies your chosen contacts with your live location — resolved the moment you're safe, never left hanging.",
  },
];

export default function Landing() {
  return (
    <div className="relative min-h-screen overflow-hidden">
      <AuroraBackground />

      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-8">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-6 w-6 text-beacon-500" />
          <span className="font-display text-lg font-semibold tracking-tight">Guardian Shield</span>
        </div>
        <div className="flex items-center gap-3">
          <Link to="/login" className="text-sm font-medium text-ink-300 hover:text-ink-100">
            Sign in
          </Link>
          <Link to="/signup" className="btn-beacon text-sm">
            Get protected
          </Link>
        </div>
      </header>

      <section className="mx-auto flex max-w-4xl flex-col items-center px-6 pb-24 pt-16 text-center">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-4 py-1.5 font-mono text-xs uppercase tracking-widest text-signal-400"
        >
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-signal-400" />
          Always sensing, never intrusive
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.1 }}
          className="font-display text-5xl font-semibold leading-[1.05] tracking-tight text-ink-100 sm:text-6xl"
        >
          A guardian that notices
          <br />
          <span className="text-beacon-500">before you have to ask.</span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="mt-6 max-w-2xl text-lg text-ink-400"
        >
          Guardian Shield reads gestures, sound, and surroundings in real time, and puts your
          trusted contacts on alert the instant something looks wrong — with one tap always
          in reserve for when you need it yourself.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.3 }}
          className="mt-10 flex items-center gap-4"
        >
          <Link to="/signup" className="btn-beacon flex items-center gap-2">
            Start free <ArrowRight className="h-4 w-4" />
          </Link>
          <Link to="/login" className="btn-ghost">
            I already have an account
          </Link>
        </motion.div>
      </section>

      <section className="mx-auto max-w-6xl px-6 pb-28">
        <div className="mb-12 text-center">
          <h2 className="font-display text-3xl font-semibold tracking-tight">
            Six ways it watches your back
          </h2>
          <p className="mt-3 text-ink-400">Every module runs quietly in the background until it matters.</p>
        </div>

        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {MODULES.map(({ icon: Icon, title, copy }) => (
            <div key={title} className="glass-panel rounded-2xl p-6">
              <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-signal-500/10 text-signal-400">
                <Icon className="h-5 w-5" />
              </div>
              <h3 className="mb-2 font-display text-lg font-medium">{title}</h3>
              <p className="text-sm leading-relaxed text-ink-400">{copy}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t border-white/[0.06] py-8 text-center text-sm text-ink-500">
        © {new Date().getFullYear()} Guardian Shield. Built to be there when it counts.
      </footer>
    </div>
  );
}
