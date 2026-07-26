import Header from "@/components/Header";
import Hero from "@/components/Hero";
import ShortageTicker from "@/components/ShortageTicker";
import StatsBar from "@/components/StatsBar";
import HowItWorks from "@/components/HowItWorks";
import ActiveShortages from "@/components/ActiveShortages";
import Quotes from "@/components/Quotes";
import BottomCTA from "@/components/BottomCTA";
import Footer from "@/components/Footer";
import { getWaitlistCount } from "@/lib/waitlist";

// Signup count is fetched per request so social proof stays current (real
// count only — no synthetic baseline; hidden until it's worth showing).
export const dynamic = "force-dynamic";

export default async function Home() {
  const count = await getWaitlistCount();

  return (
    <>
      <Header />
      <main>
        <Hero count={count} />
        <ShortageTicker />
        <StatsBar />
        <HowItWorks />
        <ActiveShortages />
        <Quotes />
        <BottomCTA count={count} />
      </main>
      <Footer />
    </>
  );
}
