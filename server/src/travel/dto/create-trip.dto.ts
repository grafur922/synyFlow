import type { CreateTripInput, TravelPrivacy } from '../travel.model'
export class CreateTripDto implements CreateTripInput {
  title!: string
  description!: string
  startDate!: string
  endDate!: string
  timezone!: string
  currency!: string
  privacy!: TravelPrivacy
  tags!: string[]
  travelers!: string[]
}
