import { detailPages } from '../content'
import { DetailPage } from '../shared/detail-page'

export const metadata = {
  title: 'Privacy Guide',
  description: 'How Clean My Agent protects local AI coding-agent session privacy.',
}

export default function PrivacyPage() {
  return <DetailPage page={detailPages.privacy} />
}
