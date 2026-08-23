import Hero from '@/components/Hero';
import CategoryCards from '@/components/CategoryCards';
import Leaderboard from '@/components/Leaderboard';
import RecentBids from '@/components/RecentBids';

export default function Home() {
  return (
    <>
      <Hero />
      <CategoryCards />
      <Leaderboard />
      <RecentBids />
    </>
  );
}
