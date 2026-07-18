import { BadRequestException, Injectable } from '@nestjs/common'
import type { GeoPoint, TravelMapLinkInput, TravelMapProvider, TravelMapTarget, TravelMode } from './travel.model'

const PROVIDERS: Array<{ id: TravelMapProvider; label: string; placeLinks: boolean; routeLinks: boolean; routeModes: TravelMode[]; externalRequestOnOpen: true }> = [
  { id: 'amap', label: '高德地图', placeLinks: true, routeLinks: false, routeModes: [], externalRequestOnOpen: true },
  { id: 'apple', label: 'Apple 地图', placeLinks: true, routeLinks: true, routeModes: ['walk', 'drive', 'transit', 'train'], externalRequestOnOpen: true },
  { id: 'google', label: 'Google 地图', placeLinks: true, routeLinks: true, routeModes: ['walk', 'bike', 'drive', 'transit', 'train'], externalRequestOnOpen: true },
  { id: 'osm', label: 'OpenStreetMap', placeLinks: true, routeLinks: true, routeModes: ['walk', 'bike', 'drive'], externalRequestOnOpen: true }
]

@Injectable()
export class TravelMapService {
  getProviders() {
    return structuredClone(PROVIDERS)
  }

  createLink(input: TravelMapLinkInput) {
    const provider = this.provider(input?.provider)
    if (input?.kind === 'place') {
      const target = normalizeTarget(input.target, 'Map target')
      return { provider: provider.id, kind: 'place' as const, url: this.placeUrl(provider.id, target), externalRequestOnOpen: true as const }
    }
    if (input?.kind !== 'route') throw new BadRequestException('Map link kind must be place or route')
    if (!provider.routeLinks) throw new BadRequestException(`${provider.label} route links are unavailable because Terra coordinates use WGS84`)
    const mode = normalizeMode(input.mode)
    if (!provider.routeModes.includes(mode)) throw new BadRequestException(`${provider.label} does not support ${mode} route links`)
    const origin = normalizeTarget(input.origin, 'Route origin')
    const destination = normalizeTarget(input.destination, 'Route destination')
    return { provider: provider.id, kind: 'route' as const, url: this.routeUrl(provider.id, origin, destination, mode), externalRequestOnOpen: true as const }
  }

  private provider(value: unknown) {
    const provider = PROVIDERS.find((item) => item.id === value)
    if (!provider) throw new BadRequestException('Unsupported map provider')
    return provider
  }

  private placeUrl(provider: TravelMapProvider, target: TravelMapTarget) {
    const query = targetQuery(target)
    if (provider === 'amap') return `https://www.amap.com/search?query=${encodeURIComponent(query)}`
    if (provider === 'apple') {
      const params = new URLSearchParams({ q: target.name })
      if (target.location) params.set('ll', pointValue(target.location))
      return `https://maps.apple.com/?${params.toString()}`
    }
    if (provider === 'google') {
      const queryValue = target.location ? pointValue(target.location) : query
      return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(queryValue)}`
    }
    if (target.location) {
      const latitude = coordinate(target.location.latitude)
      const longitude = coordinate(target.location.longitude)
      return `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=16/${latitude}/${longitude}`
    }
    return `https://www.openstreetmap.org/search?query=${encodeURIComponent(query)}`
  }

  private routeUrl(provider: TravelMapProvider, origin: TravelMapTarget, destination: TravelMapTarget, mode: TravelMode) {
    if (provider === 'apple') {
      const params = new URLSearchParams({ saddr: routeTarget(origin), daddr: routeTarget(destination) })
      const flag = appleMode(mode)
      if (flag) params.set('dirflg', flag)
      return `https://maps.apple.com/?${params.toString()}`
    }
    if (provider === 'google') {
      const params = new URLSearchParams({ api: '1', origin: routeTarget(origin), destination: routeTarget(destination) })
      const travelMode = googleMode(mode)
      if (travelMode) params.set('travelmode', travelMode)
      return `https://www.google.com/maps/dir/?${params.toString()}`
    }
    if (provider === 'osm') {
      if (!origin.location || !destination.location) throw new BadRequestException('OpenStreetMap route links require coordinates for both endpoints')
      const engine = mode === 'walk' ? 'fossgis_osrm_foot' : mode === 'bike' ? 'fossgis_osrm_bike' : 'fossgis_osrm_car'
      return `https://www.openstreetmap.org/directions?engine=${engine}&route=${encodeURIComponent(`${pointValue(origin.location)};${pointValue(destination.location)}`)}`
    }
    throw new BadRequestException('Selected map provider does not support route links')
  }
}

function normalizeTarget(value: unknown, label: string): TravelMapTarget {
  const target = value as Partial<TravelMapTarget> | undefined
  if (!target || typeof target.name !== 'string') throw new BadRequestException(`${label} is required`)
  const name = target.name.trim()
  if (!name || name.length > 300) throw new BadRequestException(`${label} name is invalid`)
  const address = target.address === undefined ? undefined : String(target.address).trim()
  if (address && address.length > 1_000) throw new BadRequestException(`${label} address is too long`)
  return { name, address: address || undefined, location: target.location ? normalizePoint(target.location) : undefined }
}

function normalizePoint(value: GeoPoint) {
  const latitude = Number(value.latitude)
  const longitude = Number(value.longitude)
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) throw new BadRequestException('Map coordinates are invalid')
  return { latitude, longitude }
}

function normalizeMode(value: unknown): TravelMode {
  const mode = value || 'drive'
  if (!['walk', 'bike', 'drive', 'transit', 'train', 'flight', 'ferry', 'other'].includes(String(mode))) throw new BadRequestException('Map travel mode is invalid')
  return mode as TravelMode
}

function routeTarget(target: TravelMapTarget) {
  return target.location ? pointValue(target.location) : targetQuery(target)
}

function targetQuery(target: TravelMapTarget) {
  return [target.name, target.address].filter(Boolean).join(' ')
}

function pointValue(point: GeoPoint) {
  return `${coordinate(point.latitude)},${coordinate(point.longitude)}`
}

function coordinate(value: number) {
  return Number(value.toFixed(6)).toString()
}

function googleMode(mode: TravelMode) {
  if (mode === 'walk') return 'walking'
  if (mode === 'bike') return 'bicycling'
  if (mode === 'transit' || mode === 'train') return 'transit'
  if (mode === 'drive') return 'driving'
  return undefined
}

function appleMode(mode: TravelMode) {
  if (mode === 'walk') return 'w'
  if (mode === 'transit' || mode === 'train') return 'r'
  if (mode === 'drive') return 'd'
  return undefined
}
