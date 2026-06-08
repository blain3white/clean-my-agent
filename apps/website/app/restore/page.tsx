import { detailPages } from '../content'
import { DetailPage } from '../shared/detail-page'

export const metadata = {
  title: 'Restore Guide',
  description: 'How to restore items from Clean My Agent Trash.',
}

export default function RestorePage() {
  return <DetailPage page={detailPages.restore} />
}
