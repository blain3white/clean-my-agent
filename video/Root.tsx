import { Composition } from 'remotion'
import { CleanMyAgentDemo } from './CleanMyAgentDemo'

export const RemotionRoot = () => {
  return (
    <Composition
      id="CleanMyAgentDemo30"
      component={CleanMyAgentDemo}
      durationInFrames={900}
      fps={30}
      width={1920}
      height={1080}
    />
  )
}
