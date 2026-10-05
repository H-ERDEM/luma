"use client";

import { DemoConsole } from "@/components/DemoConsole";
import { GetStarted } from "@/components/GetStarted";
import { Header } from "@/components/Header";
import { Hero } from "@/components/Hero";
import { HowItWorks } from "@/components/HowItWorks";
import { LivePoAPanel } from "@/components/LivePoAPanel";
import { Splash } from "@/components/Splash";

export default function Home() {
  return (
    <div id="top">
      <Header />
      <main>
        <Hero />
        <HowItWorks />
        <GetStarted />
        <LivePoAPanel />
      </main>
      <footer className="mt-10 border-t border-line">
        <div className="mx-auto flex max-w-[1200px] flex-col justify-between gap-3 px-5 py-12 pb-28 text-sm text-muted sm:flex-row sm:px-8">
          <p>LumaGrow runs on Solana Devnet with test funds. Sensor data and the oracle signer are simulated for this demo.</p>
          <p>Programs: luma_batch · luma_transfer_hook</p>
        </div>
      </footer>
      <DemoConsole />
      <Splash />
    </div>
  );
}
