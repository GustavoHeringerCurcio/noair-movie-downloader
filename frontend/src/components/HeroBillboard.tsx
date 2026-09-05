import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Download } from 'lucide-react';
import { useSearchStore } from '../store/searchStore';

export function HeroBillboard() {
  const [mediaFailed, setMediaFailed] = useState(false);
  const navigate = useNavigate();
  const openSearch = useSearchStore((s) => s.openSet);

  return (
    <section className="hero-billboard" aria-label="Movie Downloader">
      {!mediaFailed && (
        <img
          className="hero-media"
          src="/hero.gif"
          alt=""
          onError={() => setMediaFailed(true)}
        />
      )}
      <div className="hero-overlay-l" aria-hidden="true" />
      <div className="hero-overlay-b" aria-hidden="true" />
      <div className="hero-content">
        <h1 className="hero-title">Find it. Download it. Watch it.</h1>
        <p className="hero-tagline">
          Search movies &amp; TV from TMDB, grab the most-seeded release, and stream it straight
          from the download — no waiting for the whole file.
        </p>
        <div className="hero-actions">
          <button type="button" className="btn btn-white btn-lg" onClick={() => openSearch(true)}>
            <Search size={20} /> Search titles
          </button>
          <button type="button" className="btn btn-ghost btn-lg" onClick={() => navigate('/downloads')}>
            <Download size={20} /> My Downloads
          </button>
        </div>
      </div>
    </section>
  );
}
