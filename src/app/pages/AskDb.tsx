import type { SiteIndex } from '../../shared/types';

export default function AskDb(_props: {
  index: SiteIndex; authed: boolean; requireLogin: (then: () => void) => void;
}) {
  return <div />;
}
