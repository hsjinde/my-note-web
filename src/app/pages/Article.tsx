import type { SiteIndex } from '../../shared/types';

export default function Article(_props: {
  path: string; index: SiteIndex; authed: boolean;
  requireLogin: (then: () => void) => void; onSaved: () => void;
}) {
  return <div />;
}
