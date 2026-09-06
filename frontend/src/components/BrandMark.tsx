import { Link } from 'react-router-dom';

export function BrandMark() {
  return (
    <Link to="/" className="brand-mark" aria-label="noAir home">
      <span className="brand-glyph" aria-hidden="true">
        ▶
      </span>
      <span className="brand-word">noAir</span>
    </Link>
  );
}
