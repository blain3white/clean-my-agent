import { detailPages } from '../content'
import { DetailPage } from '../shared/detail-page'

export const metadata = {
  title: 'Clean Guide',
  description: 'How to safely clean AI coding-agent data with Clean My Agent.',
}

export default function CleanPage() {
  return <DetailPage page={detailPages.clean} />
}
