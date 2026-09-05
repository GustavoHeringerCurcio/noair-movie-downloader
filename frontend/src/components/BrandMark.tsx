import { Link } from 'react-router-dom';

export function BrandMark() {
  return (
    <Link to="/" className="brand-mark" aria-label="Movie Downloader home">
      <span className="brand-glyph" aria-hidden="true">
        ▶
      </span>
      <span className="brand-word">Movie Downloader</span>
    </Link>
  );
}
