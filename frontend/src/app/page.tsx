'use client';

import { BarbarianBanner, CurrentRaids, EmpireHero, LeaderboardCard, RecentActivity, YourStats } from '@/components/home';

export default function Home() {
  return (
    <>
      <div className="home-grid">
        <EmpireHero />
        <YourStats />
      </div>
      <div className="home-row">
        <CurrentRaids />
        <LeaderboardCard />
        <RecentActivity />
      </div>
      <BarbarianBanner />
    </>
  );
}
