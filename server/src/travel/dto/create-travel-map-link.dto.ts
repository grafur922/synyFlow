import type { TravelMapLinkInput, TravelMapProvider, TravelMapTarget, TravelMode } from '../travel.model'

export class CreateTravelMapLinkDto implements TravelMapLinkInput {
  provider!: TravelMapProvider
  kind!: 'place' | 'route'
  target?: TravelMapTarget
  origin?: TravelMapTarget
  destination?: TravelMapTarget
  mode?: TravelMode
}
