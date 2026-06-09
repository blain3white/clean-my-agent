import { DetailPage } from '../shared/detail-page'
import { detailPages } from '../content'

export const metadata = {
  title: 'Scan Guide',
  description: 'How Clean My Agent scans local AI coding-agent sessions.',
}

export default function ScanPage() {
  return <DetailPage page={detailPages.scan} />
}
