import { detailPages } from '../content'
import { DetailPage } from '../shared/detail-page'

export const metadata = {
  title: 'Export Guide',
  description: 'How to export AI coding-agent sessions from Clean My Agent.',
}

export default function ExportPage() {
  return <DetailPage page={detailPages.export} />
}
