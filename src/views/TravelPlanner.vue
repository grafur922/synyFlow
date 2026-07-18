<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { travelApi } from '../services/travelApi'
import TravelAssetsPanel from '../components/travel/TravelAssetsPanel.vue'
import type {
  Trip,
  TripBooking,
  TripMetrics,
  TripSummary,
  TravelCandidate,
  TravelMode,
  TravelPrivacy,
  TravelStatus
} from '../shared/travel'

type TravelTab = 'overview' | 'itinerary' | 'segments' | 'bookings' | 'budget' | 'checklist' | 'assets'
type NestedKey = 'segments' | 'bookings' | 'budget' | 'checklist'

const tabs: Array<{ id: TravelTab; label: string }> = [
  { id: 'overview', label: '概览' },
  { id: 'itinerary', label: '日程' },
  { id: 'segments', label: '交通' },
  { id: 'bookings', label: '预订' },
  { id: 'budget', label: '预算' },
  { id: 'checklist', label: '清单' },
  { id: 'assets', label: '地图与文件' }
]

const route = useRoute()
const router = useRouter()
const trips = ref<TripSummary[]>([])
const selected = ref<Trip>()
const status = ref<TravelStatus>()
const summary = ref<TripMetrics>()
const listLoading = ref(false)
const detailLoading = ref(false)
const saving = ref(false)
const error = ref('')
const tab = ref<TravelTab>('overview')
const tabScroller = ref<HTMLElement>()
const showCreate = ref(false)
const candidates = ref<TravelCandidate[]>([])
const candidateOpen = ref(false)
const candidateLoading = ref(false)
const candidateImporting = ref(false)
const candidateSaving = ref(false)
const selectedCandidate = ref<TravelCandidate>()
const candidateScope = ref<'active' | 'added' | 'dismissed'>('active')
const candidateImportPrivacy = ref<TravelPrivacy>('private')
const candidateTargetTrip = ref<Trip>()
const candidateTargetTripId = ref('')
const candidateTargetDayId = ref('')
const candidateNotice = ref('')
let selectionRequest = 0

const createForm = reactive({
  title: '',
  description: '',
  startDate: '',
  endDate: '',
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  currency: 'CNY',
  privacy: 'private' as TravelPrivacy,
  tags: '',
  travelers: ''
})

const editForm = reactive({
  title: '',
  description: '',
  startDate: '',
  endDate: '',
  timezone: '',
  currency: '',
  privacy: 'private' as TravelPrivacy,
  status: 'planning' as Trip['status'],
  tags: '',
  travelers: ''
})

const dayForm = reactive({ date: '', title: '' })
const placeForm = reactive({ dayId: '', name: '', address: '', startTime: '', endTime: '', latitude: '', longitude: '', cost: '' })
const segmentForm = reactive({ fromPlaceId: '', toPlaceId: '', fromName: '', toName: '', mode: 'train' as TravelMode, departureAt: '', arrivalAt: '', cost: '' })
const bookingForm = reactive<{ type: TripBooking['type']; title: string; provider: string; confirmation: string; startsAt: string; endsAt: string; cost: string }>({ type: 'lodging', title: '', provider: '', confirmation: '', startsAt: '', endsAt: '', cost: '' })
const budgetForm = reactive({ category: '', amount: '', currency: '', paid: false })
const checklistText = ref('')
const candidateForm = reactive({ title: '', summary: '', tags: '', placeName: '', address: '', latitude: '', longitude: '', notes: '' })

const allPlaces = computed(() => selected.value?.days.flatMap((day) => day.places.map((place) => ({ ...place, dayDate: day.date }))) || [])
const inboxCandidateCount = computed(() => candidates.value.filter((candidate) => candidate.status === 'inbox').length)
const visibleCandidates = computed(() => candidates.value.filter((candidate) => candidateScope.value === 'active'
  ? candidate.status === 'inbox' || candidate.status === 'saved'
  : candidate.status === candidateScope.value))

onMounted(async () => {
  await Promise.all([refreshList(), loadCandidates()])
  const tripId = queryValue(route.query.trip)
  if (tripId) await selectTrip(tripId)
})

async function loadCandidates() {
  candidateLoading.value = true
  try {
    candidates.value = await travelApi.getCandidates()
    syncCandidateCount()
  } catch (cause) {
    error.value = messageFrom(cause)
  } finally {
    candidateLoading.value = false
  }
}

async function importCandidates() {
  if (candidateImporting.value) return
  candidateImporting.value = true
  candidateNotice.value = ''
  try {
    const result = await travelApi.importFavoriteCandidates(candidateImportPrivacy.value)
    await Promise.all([loadCandidates(), refreshList(false)])
    candidateNotice.value = `新增 ${result.imported} 条，刷新 ${result.refreshed} 条，未变化 ${result.unchanged} 条`
  } catch (cause) {
    error.value = messageFrom(cause)
  } finally {
    candidateImporting.value = false
  }
}

async function openCandidate(candidate: TravelCandidate) {
  selectedCandidate.value = candidate
  Object.assign(candidateForm, {
    title: candidate.title,
    summary: candidate.summary,
    tags: candidate.tags.join(', '),
    placeName: candidate.placeName,
    address: candidate.address,
    latitude: candidate.location?.latitude === undefined ? '' : String(candidate.location.latitude),
    longitude: candidate.location?.longitude === undefined ? '' : String(candidate.location.longitude),
    notes: candidate.notes
  })
  candidateTargetTripId.value = candidate.tripId || selected.value?.id || trips.value[0]?.id || ''
  await loadCandidateTargetTrip(candidateTargetTripId.value)
  candidateTargetDayId.value = candidate.dayId || candidateTargetTrip.value?.days[0]?.id || ''
}

async function loadCandidateTargetTrip(id: string) {
  candidateTargetTripId.value = id
  candidateTargetDayId.value = ''
  candidateTargetTrip.value = undefined
  if (!id) return
  try {
    candidateTargetTrip.value = await travelApi.getTrip(id)
    candidateTargetDayId.value = candidateTargetTrip.value.days[0]?.id || ''
  } catch (cause) {
    error.value = messageFrom(cause)
  }
}

function candidatePatch() {
  const hasLatitude = Boolean(candidateForm.latitude.trim())
  const hasLongitude = Boolean(candidateForm.longitude.trim())
  if (hasLatitude !== hasLongitude) throw new Error('候选地点的经纬度必须同时填写')
  const latitude = hasLatitude ? Number(candidateForm.latitude) : undefined
  const longitude = hasLongitude ? Number(candidateForm.longitude) : undefined
  if ((latitude !== undefined && !Number.isFinite(latitude)) || (longitude !== undefined && !Number.isFinite(longitude))) throw new Error('候选地点坐标格式无效')
  return {
    title: candidateForm.title,
    summary: candidateForm.summary,
    tags: splitList(candidateForm.tags),
    placeName: candidateForm.placeName,
    address: candidateForm.address,
    location: latitude === undefined || longitude === undefined ? null : { latitude, longitude },
    notes: candidateForm.notes
  }
}

async function saveCandidate(status?: TravelCandidate['status']) {
  if (!selectedCandidate.value || candidateSaving.value) return undefined
  candidateSaving.value = true
  try {
    const candidate = await travelApi.updateCandidate(selectedCandidate.value.id, { ...candidatePatch(), status: status || selectedCandidate.value.status })
    selectedCandidate.value = candidate
    candidates.value = candidates.value.map((item) => item.id === candidate.id ? candidate : item)
    candidateNotice.value = '候选已保存'
    return candidate
  } catch (cause) {
    error.value = messageFrom(cause)
    return undefined
  } finally {
    candidateSaving.value = false
  }
}

async function addCandidateToTrip() {
  if (!selectedCandidate.value || !candidateTargetTripId.value || !candidateTargetDayId.value || candidateSaving.value) return
  const saved = await saveCandidate()
  if (!saved) return
  candidateSaving.value = true
  try {
    const result = await travelApi.addCandidateToTrip(saved.id, candidateTargetTripId.value, candidateTargetDayId.value)
    selectedCandidate.value = result.candidate
    candidates.value = candidates.value.map((item) => item.id === result.candidate.id ? result.candidate : item)
    if (selected.value?.id === result.trip.id) {
      applyTrip(result.trip)
      summary.value = await travelApi.getSummary(result.trip.id)
    }
    candidateTargetTrip.value = result.trip
    candidateNotice.value = `已加入 ${result.trip.title}`
    await refreshList(false)
  } catch (cause) {
    error.value = messageFrom(cause)
  } finally {
    candidateSaving.value = false
  }
}

async function deleteCandidate() {
  if (!selectedCandidate.value || candidateSaving.value || !window.confirm('确定删除这张旅行候选卡吗？已加入的行程地点不会被删除。')) return
  candidateSaving.value = true
  try {
    const id = selectedCandidate.value.id
    await travelApi.deleteCandidate(id)
    candidates.value = candidates.value.filter((item) => item.id !== id)
    syncCandidateCount()
    selectedCandidate.value = undefined
    candidateNotice.value = '候选卡已删除'
  } catch (cause) {
    error.value = messageFrom(cause)
  } finally {
    candidateSaving.value = false
  }
}

function openCandidateSource(candidate: TravelCandidate) {
  candidateOpen.value = false
  if (candidate.source === 'xiaomi') void router.push({ path: '/xiaomi-notes', query: { note: candidate.sourceId } })
  else void router.push({ path: '/rss', query: { item: candidate.sourceId } })
}

function syncCandidateCount() {
  if (!status.value) return
  status.value = { ...status.value, candidateCount: candidates.value.length }
}

watch(() => queryValue(route.query.trip), (tripId, previous) => {
  if (tripId && tripId !== previous && tripId !== selected.value?.id) void selectTrip(tripId)
})

watch(tab, async (activeTab) => {
  await nextTick()
  tabScroller.value?.querySelector<HTMLElement>(`[data-travel-tab="${activeTab}"]`)?.scrollIntoView({ behavior: 'auto', block: 'nearest', inline: 'end' })
})

async function refreshList(showLoading = true) {
  if (showLoading) listLoading.value = true
  error.value = ''
  try {
    const [nextStatus, nextTrips] = await Promise.all([travelApi.getStatus(), travelApi.getTrips()])
    status.value = nextStatus
    trips.value = nextTrips
  } catch (cause) {
    error.value = messageFrom(cause)
  } finally {
    if (showLoading) listLoading.value = false
  }
}

async function selectTrip(target: TripSummary | string) {
  const id = typeof target === 'string' ? target : target.id
  const requestId = ++selectionRequest
  detailLoading.value = true
  error.value = ''
  try {
    const [trip, metrics] = await Promise.all([travelApi.getTrip(id), travelApi.getSummary(id)])
    if (requestId !== selectionRequest) return
    applyTrip(trip)
    summary.value = metrics
  } catch (cause) {
    if (requestId === selectionRequest) error.value = messageFrom(cause)
  } finally {
    if (requestId === selectionRequest) detailLoading.value = false
  }
}

function applyTrip(trip: Trip) {
  selected.value = trip
  Object.assign(editForm, {
    title: trip.title,
    description: trip.description,
    startDate: trip.startDate,
    endDate: trip.endDate,
    timezone: trip.timezone,
    currency: trip.currency,
    privacy: trip.privacy,
    status: trip.status,
    tags: trip.tags.join(', '),
    travelers: trip.travelers.join(', ')
  })
  dayForm.date = trip.startDate
  placeForm.dayId = trip.days[0]?.id || ''
  budgetForm.currency = trip.currency
}

async function createTrip() {
  if (saving.value) return
  saving.value = true
  error.value = ''
  try {
    const trip = await travelApi.createTrip({
      ...createForm,
      currency: createForm.currency.toUpperCase(),
      tags: splitList(createForm.tags),
      travelers: splitList(createForm.travelers)
    })
    applyTrip(trip)
    summary.value = await travelApi.getSummary(trip.id)
    showCreate.value = false
    Object.assign(createForm, { title: '', description: '', startDate: '', endDate: '', tags: '', travelers: '' })
    await refreshList(false)
  } catch (cause) {
    error.value = messageFrom(cause)
  } finally {
    saving.value = false
  }
}

async function updateTrip(patch: Partial<Omit<Trip, 'id' | 'createdAt' | 'updatedAt'>>) {
  if (!selected.value || saving.value) return undefined
  const id = selected.value.id
  saving.value = true
  error.value = ''
  try {
    const trip = await travelApi.updateTrip(id, patch)
    if (selected.value?.id === id) applyTrip(trip)
    const [metrics] = await Promise.all([travelApi.getSummary(id), refreshList(false)])
    if (selected.value?.id === id) summary.value = metrics
    return trip
  } catch (cause) {
    error.value = messageFrom(cause)
    return undefined
  } finally {
    saving.value = false
  }
}

async function saveOverview() {
  await updateTrip({
    ...editForm,
    currency: editForm.currency.toUpperCase(),
    tags: splitList(editForm.tags),
    travelers: splitList(editForm.travelers)
  })
}

async function addDay() {
  if (!selected.value || !dayForm.date) return
  const result = await updateTrip({
    days: [...selected.value.days, { id: crypto.randomUUID(), date: dayForm.date, title: dayForm.title, notes: '', places: [] }]
  })
  if (result) dayForm.title = ''
}

async function removeDay(id: string) {
  if (!selected.value || !window.confirm('删除该日及其地点吗？')) return
  const placeIds = new Set(selected.value.days.find((day) => day.id === id)?.places.map((place) => place.id) || [])
  await updateTrip({
    days: selected.value.days.filter((day) => day.id !== id),
    segments: selected.value.segments.filter((segment) => !placeIds.has(segment.fromPlaceId || '') && !placeIds.has(segment.toPlaceId || ''))
  })
}

async function addPlace() {
  if (!selected.value || !placeForm.dayId || !placeForm.name.trim()) return
  const hasLatitude = Boolean(placeForm.latitude.trim())
  const hasLongitude = Boolean(placeForm.longitude.trim())
  if (hasLatitude !== hasLongitude) {
    error.value = '经纬度必须同时填写'
    return
  }
  const latitude = hasLatitude ? Number(placeForm.latitude) : undefined
  const longitude = hasLongitude ? Number(placeForm.longitude) : undefined
  if ((latitude !== undefined && !Number.isFinite(latitude)) || (longitude !== undefined && !Number.isFinite(longitude))) {
    error.value = '经纬度格式无效'
    return
  }
  const days = structuredClone(selected.value.days)
  const day = days.find((item) => item.id === placeForm.dayId)
  if (!day) return
  const hasCost = placeForm.cost !== ''
  day.places.push({
    id: crypto.randomUUID(),
    name: placeForm.name.trim(),
    address: placeForm.address.trim(),
    location: latitude !== undefined && longitude !== undefined ? { latitude, longitude } : undefined,
    startTime: placeForm.startTime || undefined,
    endTime: placeForm.endTime || undefined,
    notes: '',
    cost: hasCost ? Number(placeForm.cost) : undefined,
    currency: hasCost ? selected.value.currency : undefined
  })
  const result = await updateTrip({ days })
  if (result) Object.assign(placeForm, { name: '', address: '', startTime: '', endTime: '', latitude: '', longitude: '', cost: '' })
}

async function removePlace(dayId: string, placeId: string) {
  if (!selected.value) return
  const days = structuredClone(selected.value.days)
  const day = days.find((item) => item.id === dayId)
  if (day) day.places = day.places.filter((place) => place.id !== placeId)
  await updateTrip({
    days,
    segments: selected.value.segments.filter((segment) => segment.fromPlaceId !== placeId && segment.toPlaceId !== placeId)
  })
}

async function addSegment() {
  if (!selected.value) return
  if (segmentForm.fromPlaceId && segmentForm.fromPlaceId === segmentForm.toPlaceId) {
    error.value = '起点和终点不能是同一地点'
    return
  }
  const from = allPlaces.value.find((place) => place.id === segmentForm.fromPlaceId)
  const to = allPlaces.value.find((place) => place.id === segmentForm.toPlaceId)
  const fromName = (segmentForm.fromName || from?.name || '').trim()
  const toName = (segmentForm.toName || to?.name || '').trim()
  if (!fromName || !toName) {
    error.value = '交通段必须同时提供起点和终点'
    return
  }
  const hasCost = segmentForm.cost !== ''
  const result = await updateTrip({
    segments: [...selected.value.segments, {
      id: crypto.randomUUID(),
      fromPlaceId: segmentForm.fromPlaceId || undefined,
      toPlaceId: segmentForm.toPlaceId || undefined,
      fromName,
      toName,
      mode: segmentForm.mode,
      departureAt: segmentForm.departureAt || undefined,
      arrivalAt: segmentForm.arrivalAt || undefined,
      cost: hasCost ? Number(segmentForm.cost) : undefined,
      currency: hasCost ? selected.value.currency : undefined,
      notes: ''
    }]
  })
  if (result) Object.assign(segmentForm, { fromPlaceId: '', toPlaceId: '', fromName: '', toName: '', departureAt: '', arrivalAt: '', cost: '' })
}

async function addBooking() {
  if (!selected.value || !bookingForm.title.trim()) return
  const hasCost = bookingForm.cost !== ''
  const result = await updateTrip({
    bookings: [...selected.value.bookings, {
      id: crypto.randomUUID(),
      type: bookingForm.type,
      title: bookingForm.title.trim(),
      provider: bookingForm.provider.trim() || undefined,
      confirmation: bookingForm.confirmation.trim() || undefined,
      startsAt: bookingForm.startsAt || undefined,
      endsAt: bookingForm.endsAt || undefined,
      cost: hasCost ? Number(bookingForm.cost) : undefined,
      currency: hasCost ? selected.value.currency : undefined,
      status: 'planned',
      notes: ''
    }]
  })
  if (result) Object.assign(bookingForm, { title: '', provider: '', confirmation: '', startsAt: '', endsAt: '', cost: '' })
}

async function addBudget() {
  if (!selected.value || !budgetForm.category.trim() || budgetForm.amount === '') return
  const result = await updateTrip({
    budget: [...selected.value.budget, {
      id: crypto.randomUUID(),
      category: budgetForm.category.trim(),
      amount: Number(budgetForm.amount),
      currency: (budgetForm.currency || selected.value.currency).toUpperCase(),
      paid: budgetForm.paid,
      notes: ''
    }]
  })
  if (result) Object.assign(budgetForm, { category: '', amount: '', paid: false })
}

async function addChecklist() {
  if (!selected.value || !checklistText.value.trim()) return
  const result = await updateTrip({
    checklist: [...selected.value.checklist, { id: crypto.randomUUID(), text: checklistText.value.trim(), completed: false, category: '' }]
  })
  if (result) checklistText.value = ''
}

async function toggleChecklist(id: string) {
  if (!selected.value) return
  await updateTrip({ checklist: selected.value.checklist.map((item) => item.id === id ? { ...item, completed: !item.completed } : item) })
}

async function removeNested(key: NestedKey, id: string) {
  if (!selected.value) return
  const patch = { [key]: selected.value[key].filter((item) => item.id !== id) } as Partial<Omit<Trip, 'id' | 'createdAt' | 'updatedAt'>>
  await updateTrip(patch)
}

async function duplicateTrip() {
  if (!selected.value || saving.value) return
  saving.value = true
  error.value = ''
  try {
    const trip = await travelApi.duplicateTrip(selected.value.id)
    applyTrip(trip)
    summary.value = await travelApi.getSummary(trip.id)
    await refreshList(false)
  } catch (cause) {
    error.value = messageFrom(cause)
  } finally {
    saving.value = false
  }
}

async function deleteTrip() {
  if (!selected.value || saving.value || !window.confirm('确定删除整个行程吗？')) return
  saving.value = true
  error.value = ''
  try {
    await travelApi.deleteTrip(selected.value.id)
    selectionRequest += 1
    selected.value = undefined
    summary.value = undefined
    await refreshList(false)
  } catch (cause) {
    error.value = messageFrom(cause)
  } finally {
    saving.value = false
  }
}

async function exportTrip(format: 'json' | 'markdown') {
  if (!selected.value) return
  error.value = ''
  try {
    const result = await travelApi.exportTrip(selected.value.id, format)
    const blob = new Blob([result.content], { type: format === 'json' ? 'application/json' : 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = result.filename
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 0)
  } catch (cause) {
    error.value = messageFrom(cause)
  }
}

async function refreshTravelAssets() {
  const id = selected.value?.id
  try {
    const [metrics] = await Promise.all([id ? travelApi.getSummary(id) : Promise.resolve(undefined), refreshList(false)])
    if (id && selected.value?.id === id && metrics) summary.value = metrics
  } catch (cause) {
    error.value = messageFrom(cause)
  }
}

async function selectImportedTrip(trip: Trip) {
  applyTrip(trip)
  tab.value = 'assets'
  try {
    summary.value = await travelApi.getSummary(trip.id)
  } catch (cause) {
    error.value = messageFrom(cause)
  }
}

function splitList(value: string) {
  return value.split(/[,，]/).map((item) => item.trim()).filter(Boolean)
}

function queryValue(value: unknown) {
  if (typeof value === 'string') return value
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0]
  return ''
}

function messageFrom(cause: unknown) {
  return cause instanceof Error ? cause.message : '发生未知错误'
}

function formatInstant(value?: string) {
  if (!value) return '时间未定'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date)
}

function modeLabel(value: string) {
  return ({ walk: '步行', bike: '骑行', drive: '驾车', transit: '公交', train: '火车', flight: '航班', ferry: '轮渡', other: '其他' } as Record<string, string>)[value] || value
}

function tripStatusLabel(value: string) {
  return ({ planning: '规划中', active: '进行中', completed: '已完成', archived: '已归档' } as Record<string, string>)[value] || value
}

function candidateStatusLabel(value: string) {
  return ({ inbox: '待处理', saved: '已保留', added: '已加入', dismissed: '已忽略' } as Record<string, string>)[value] || value
}

function privacyLabel(value: TravelPrivacy) {
  return ({ public: '公开级', private: '私人', secret: '机密' } as Record<TravelPrivacy, string>)[value]
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col bg-background">
    <header class="flex flex-shrink-0 flex-wrap items-center justify-between gap-3 border-b border-outline-variant/25 px-5 py-4 md:px-7">
      <div>
        <div class="flex items-center gap-2">
          <span class="material-symbols-outlined text-primary">travel</span>
          <h2 class="font-headline text-2xl font-bold">旅行规划</h2>
        </div>
        <p class="mt-1 text-xs text-secondary">
          {{ status?.tripCount || 0 }} 个行程 · {{ status?.candidateCount || 0 }} 条候选 ·
          <span :class="status?.encryptedAtRest ? 'text-primary' : 'text-tertiary'">{{ status?.encryptedAtRest ? '数据已加密' : '数据未加密' }}</span>
        </p>
      </div>
      <div class="flex w-full items-center justify-end gap-2 sm:w-auto"><button type="button" class="flex h-10 items-center gap-1.5 rounded-lg border border-outline-variant/40 px-3 text-sm font-bold text-primary" @click="candidateOpen = true"><span class="material-symbols-outlined text-[19px]">bookmarks</span><span>候选</span><span v-if="inboxCandidateCount" class="rounded-full bg-primary px-1.5 py-0.5 text-[9px] text-on-primary">{{ inboxCandidateCount }}</span></button><button type="button" class="flex h-10 items-center rounded-lg bg-primary px-4 text-sm font-bold text-on-primary disabled:opacity-40" :disabled="saving" @click="showCreate = true"><span class="material-symbols-outlined mr-1 text-[19px]">add</span>新建行程</button></div>
    </header>

    <div v-if="error" role="alert" class="mx-4 mt-3 flex items-start gap-2 rounded-lg bg-error-container/60 p-3 text-sm text-on-error-container">
      <span class="material-symbols-outlined text-[20px]">error</span><span class="min-w-0 flex-1">{{ error }}</span>
      <button type="button" class="icon-button" aria-label="关闭错误提示" @click="error = ''"><span class="material-symbols-outlined text-[18px]">close</span></button>
    </div>

    <div class="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[300px_minmax(0,1fr)]">
      <aside class="min-h-0 border-r border-outline-variant/25 bg-surface-container-low/45" :class="{ 'hidden md:block': selected }">
        <div class="h-full overflow-y-auto p-3">
          <div v-if="listLoading && !trips.length" class="empty-state"><span class="material-symbols-outlined animate-spin">progress_activity</span><p>读取行程中…</p></div>
          <button
            v-for="trip in trips"
            :key="trip.id"
            type="button"
            class="mb-2 w-full rounded-lg border p-4 text-left transition"
            :class="selected?.id === trip.id ? 'border-primary/40 bg-primary-container text-on-primary-container' : 'border-transparent bg-surface-bright hover:border-outline-variant/40'"
            @click="selectTrip(trip)"
          >
            <div class="flex items-start justify-between gap-2">
              <h3 class="line-clamp-2 min-w-0 text-sm font-bold">{{ trip.title }}</h3>
              <span class="flex-shrink-0 text-[9px] font-bold">{{ tripStatusLabel(trip.status) }}</span>
            </div>
            <p class="mt-2 text-xs opacity-70">{{ trip.startDate }} → {{ trip.endDate }}</p>
            <div class="mt-2 flex items-center justify-between gap-2 text-[10px] opacity-65">
              <span>{{ trip.dayCount }} 天 · {{ trip.bookingCount }} 预订</span>
              <span class="truncate">{{ trip.timezone }}</span>
            </div>
          </button>
          <div v-if="!listLoading && !trips.length" class="empty-state"><span class="material-symbols-outlined text-4xl">luggage</span><p>还没有行程</p></div>
        </div>
      </aside>

      <main class="h-full min-h-0 min-w-0" :class="selected ? 'block' : 'hidden md:block'">
        <div v-if="detailLoading" class="flex h-full items-center justify-center text-secondary"><span class="material-symbols-outlined mr-2 animate-spin">progress_activity</span>加载行程中…</div>
        <div v-else-if="selected" class="flex h-full min-h-0 flex-col">
          <div class="flex flex-shrink-0 items-center justify-between gap-2 border-b border-outline-variant/20 p-3">
            <button type="button" class="toolbar md:hidden" aria-label="返回行程列表" @click="selected = undefined"><span class="material-symbols-outlined">arrow_back</span></button>
            <div ref="tabScroller" class="no-scrollbar flex min-w-0 flex-1 gap-1 overflow-x-auto">
              <button v-for="item in tabs" :key="item.id" type="button" :data-travel-tab="item.id" class="whitespace-nowrap rounded-lg px-3 py-2 text-xs font-bold" :class="tab === item.id ? 'bg-primary text-on-primary' : 'text-secondary hover:bg-surface-container-high'" :aria-pressed="tab === item.id" @click="tab = item.id">{{ item.label }}</button>
            </div>
            <div class="flex flex-shrink-0 gap-1">
              <button type="button" class="toolbar" title="导出 Markdown" aria-label="导出 Markdown" @click="exportTrip('markdown')"><span class="material-symbols-outlined">download</span></button>
              <button type="button" class="toolbar hidden sm:flex" title="导出 JSON" aria-label="导出 JSON" @click="exportTrip('json')"><span class="material-symbols-outlined">data_object</span></button>
              <button type="button" class="toolbar hidden sm:flex" title="复制行程" aria-label="复制行程" :disabled="saving" @click="duplicateTrip"><span class="material-symbols-outlined">content_copy</span></button>
              <button type="button" class="toolbar text-error" title="删除行程" aria-label="删除行程" :disabled="saving" @click="deleteTrip"><span class="material-symbols-outlined">delete</span></button>
            </div>
          </div>

          <div class="min-h-0 flex-1 overflow-y-auto p-5 md:p-7">
            <section v-if="tab === 'overview'" class="mx-auto max-w-4xl">
              <div class="grid gap-4 md:grid-cols-2">
                <label class="field md:col-span-2">行程名称<input v-model="editForm.title" maxlength="300" /></label>
                <label class="field">开始日期<input v-model="editForm.startDate" type="date" /></label>
                <label class="field">结束日期<input v-model="editForm.endDate" type="date" /></label>
                <label class="field">时区<input v-model="editForm.timezone" /></label>
                <label class="field">默认货币<input v-model="editForm.currency" maxlength="3" /></label>
                <label class="field">状态<select v-model="editForm.status"><option value="planning">规划中</option><option value="active">进行中</option><option value="completed">已完成</option><option value="archived">已归档</option></select></label>
                <label class="field">隐私<select v-model="editForm.privacy"><option value="private">私人</option><option value="secret">机密</option><option value="public">公开级</option></select></label>
                <label class="field md:col-span-2">描述<textarea v-model="editForm.description" maxlength="10000" rows="4"></textarea></label>
                <label class="field">标签<input v-model="editForm.tags" placeholder="逗号分隔" /></label>
                <label class="field">同行人<input v-model="editForm.travelers" placeholder="逗号分隔" /></label>
              </div>
              <button type="button" class="mt-5 rounded-lg bg-primary px-5 py-2 text-sm font-bold text-on-primary disabled:opacity-40" :disabled="saving" @click="saveOverview">{{ saving ? '保存中…' : '保存概览' }}</button>
              <div v-if="summary" class="mt-7 grid grid-cols-2 gap-3 md:grid-cols-4">
                <div class="stat"><b>{{ summary.days }}</b><span>天</span></div>
                <div class="stat"><b>{{ summary.places }}</b><span>地点</span></div>
                <div class="stat"><b>{{ summary.totalDistanceKm }}</b><span>公里</span></div>
                <div class="stat"><b>{{ summary.checklist.completed }}/{{ summary.checklist.total }}</b><span>清单</span></div>
              </div>
            </section>

            <section v-else-if="tab === 'itinerary'" class="mx-auto max-w-5xl">
              <form class="panel mb-5 flex flex-wrap gap-2" @submit.prevent="addDay">
                <input v-model="dayForm.date" class="min-w-[150px] flex-1" required type="date" aria-label="日期" />
                <input v-model="dayForm.title" class="min-w-[150px] flex-1" placeholder="当天标题" aria-label="当天标题" />
                <button class="form-action" :disabled="saving">添加一天</button>
              </form>
              <div class="space-y-4">
                <article v-for="day in selected.days" :key="day.id" class="panel">
                  <div class="flex items-start justify-between gap-3">
                    <h3 class="font-headline text-lg font-bold">{{ day.date }}<span v-if="day.title"> · {{ day.title }}</span></h3>
                    <button type="button" class="icon-button text-error" title="删除当天" aria-label="删除当天" :disabled="saving" @click="removeDay(day.id)"><span class="material-symbols-outlined text-[19px]">delete</span></button>
                  </div>
                  <div class="mt-3 space-y-2">
                    <div v-for="place in day.places" :key="place.id" class="flex items-start gap-3 rounded-lg bg-surface-bright p-3">
                      <time class="w-12 flex-shrink-0 text-xs font-bold text-primary">{{ place.startTime || '--:--' }}</time>
                      <div class="min-w-0 flex-1"><p class="font-bold">{{ place.name }}</p><p v-if="place.address" class="mt-1 break-words text-xs text-secondary">{{ place.address }}</p></div>
                      <button type="button" class="icon-button text-error" title="删除地点" aria-label="删除地点" :disabled="saving" @click="removePlace(day.id, place.id)"><span class="material-symbols-outlined text-[18px]">delete</span></button>
                    </div>
                  </div>
                </article>
                <div v-if="!selected.days.length" class="empty-state"><span class="material-symbols-outlined text-4xl">event_busy</span><p>还没有日程</p></div>
              </div>
              <form class="panel mt-5 grid gap-2 md:grid-cols-3" @submit.prevent="addPlace">
                <select v-model="placeForm.dayId" required aria-label="选择日期"><option value="">选择日期</option><option v-for="day in selected.days" :key="day.id" :value="day.id">{{ day.date }}</option></select>
                <input v-model="placeForm.name" required placeholder="地点名称" aria-label="地点名称" />
                <input v-model="placeForm.address" placeholder="地址" aria-label="地址" />
                <input v-model="placeForm.startTime" type="time" aria-label="开始时间" />
                <input v-model="placeForm.endTime" type="time" aria-label="结束时间" />
                <input v-model="placeForm.cost" type="number" min="0" step="0.01" placeholder="费用" aria-label="费用" />
                <input v-model="placeForm.latitude" type="number" min="-90" max="90" step="any" placeholder="纬度" aria-label="纬度" />
                <input v-model="placeForm.longitude" type="number" min="-180" max="180" step="any" placeholder="经度" aria-label="经度" />
                <button class="form-action" :disabled="saving || !selected.days.length">添加地点</button>
              </form>
            </section>

            <section v-else-if="tab === 'segments'" class="mx-auto max-w-5xl">
              <div class="space-y-3">
                <div v-for="item in selected.segments" :key="item.id" class="panel flex items-start gap-4">
                  <span class="material-symbols-outlined text-primary">route</span>
                  <div class="min-w-0 flex-1"><p class="break-words font-bold">{{ item.fromName }} → {{ item.toName }}</p><p class="mt-1 text-xs text-secondary">{{ modeLabel(item.mode) }} · {{ item.distanceKm || 0 }} km · {{ item.durationMinutes || 0 }} 分钟</p><p class="mt-1 text-[10px] text-secondary">{{ formatInstant(item.departureAt) }} → {{ formatInstant(item.arrivalAt) }}</p></div>
                  <button type="button" class="icon-button text-error" title="删除交通段" aria-label="删除交通段" :disabled="saving" @click="removeNested('segments', item.id)"><span class="material-symbols-outlined text-[18px]">delete</span></button>
                </div>
                <div v-if="!selected.segments.length" class="empty-state"><span class="material-symbols-outlined text-4xl">route</span><p>还没有交通段</p></div>
              </div>
              <form class="panel mt-5 grid gap-2 md:grid-cols-2" @submit.prevent="addSegment">
                <select v-model="segmentForm.fromPlaceId" aria-label="起点"><option value="">起点（手动）</option><option v-for="place in allPlaces" :key="place.id" :value="place.id">{{ place.dayDate }} · {{ place.name }}</option></select>
                <select v-model="segmentForm.toPlaceId" aria-label="终点"><option value="">终点（手动）</option><option v-for="place in allPlaces" :key="place.id" :value="place.id">{{ place.dayDate }} · {{ place.name }}</option></select>
                <input v-model="segmentForm.fromName" placeholder="手动起点名称" aria-label="手动起点名称" />
                <input v-model="segmentForm.toName" placeholder="手动终点名称" aria-label="手动终点名称" />
                <select v-model="segmentForm.mode" aria-label="交通方式"><option v-for="item in ['walk','bike','drive','transit','train','flight','ferry','other']" :key="item" :value="item">{{ modeLabel(item) }}</option></select>
                <input v-model="segmentForm.cost" type="number" min="0" step="0.01" placeholder="费用" aria-label="费用" />
                <input v-model="segmentForm.departureAt" placeholder="出发时间（含时区的 ISO 时间）" aria-label="出发时间" />
                <input v-model="segmentForm.arrivalAt" placeholder="到达时间（含时区的 ISO 时间）" aria-label="到达时间" />
                <button class="form-action md:col-span-2" :disabled="saving">添加交通段</button>
              </form>
            </section>

            <section v-else-if="tab === 'bookings'" class="mx-auto max-w-5xl">
              <div class="space-y-2">
                <div v-for="item in selected.bookings" :key="item.id" class="panel flex items-start justify-between gap-3">
                  <div class="min-w-0"><p class="break-words font-bold">{{ item.title }}</p><p class="mt-1 break-words text-xs text-secondary">{{ item.type }}<span v-if="item.provider"> · {{ item.provider }}</span><span v-if="item.confirmation"> · {{ item.confirmation }}</span></p></div>
                  <button type="button" class="icon-button text-error" title="删除预订" aria-label="删除预订" :disabled="saving" @click="removeNested('bookings', item.id)"><span class="material-symbols-outlined text-[18px]">delete</span></button>
                </div>
                <div v-if="!selected.bookings.length" class="empty-state"><span class="material-symbols-outlined text-4xl">confirmation_number</span><p>还没有预订</p></div>
              </div>
              <form class="panel mt-5 grid gap-2 md:grid-cols-2" @submit.prevent="addBooking">
                <select v-model="bookingForm.type" aria-label="预订类型"><option value="lodging">住宿</option><option value="transport">交通</option><option value="activity">活动</option><option value="restaurant">餐厅</option><option value="other">其他</option></select>
                <input v-model="bookingForm.title" required placeholder="预订名称" aria-label="预订名称" />
                <input v-model="bookingForm.provider" placeholder="供应商" aria-label="供应商" />
                <input v-model="bookingForm.confirmation" placeholder="确认号" aria-label="确认号" />
                <input v-model="bookingForm.startsAt" placeholder="开始时间（含时区的 ISO 时间）" aria-label="开始时间" />
                <input v-model="bookingForm.endsAt" placeholder="结束时间（含时区的 ISO 时间）" aria-label="结束时间" />
                <input v-model="bookingForm.cost" type="number" min="0" step="0.01" placeholder="费用" aria-label="费用" />
                <button class="form-action" :disabled="saving">添加预订</button>
              </form>
            </section>

            <section v-else-if="tab === 'budget'" class="mx-auto max-w-4xl">
              <div v-if="summary && Object.keys(summary.budgetByCurrency).length" class="mb-5 grid gap-3 md:grid-cols-3">
                <div v-for="(value, currency) in summary.budgetByCurrency" :key="currency" class="stat"><b>{{ currency }} {{ value.total }}</b><span>已付 {{ value.paid }} · 未付 {{ value.unpaid }}</span></div>
              </div>
              <div class="space-y-2">
                <div v-for="item in selected.budget" :key="item.id" class="panel flex items-start justify-between gap-3">
                  <span class="min-w-0 break-words">{{ item.category }} · {{ item.currency }} {{ item.amount }} · {{ item.paid ? '已支付' : '未支付' }}</span>
                  <button type="button" class="icon-button text-error" title="删除预算" aria-label="删除预算" :disabled="saving" @click="removeNested('budget', item.id)"><span class="material-symbols-outlined text-[18px]">delete</span></button>
                </div>
                <div v-if="!selected.budget.length" class="empty-state"><span class="material-symbols-outlined text-4xl">payments</span><p>还没有预算</p></div>
              </div>
              <form class="panel mt-5 flex flex-wrap items-center gap-2" @submit.prevent="addBudget">
                <input v-model="budgetForm.category" class="min-w-[140px] flex-1" required placeholder="分类" aria-label="分类" />
                <input v-model="budgetForm.amount" class="min-w-[120px] flex-1" required type="number" min="0" step="0.01" placeholder="金额" aria-label="金额" />
                <input v-model="budgetForm.currency" class="w-24" maxlength="3" placeholder="货币" aria-label="货币" />
                <label class="flex items-center gap-2 text-xs"><input v-model="budgetForm.paid" class="h-4 w-4" type="checkbox" />已支付</label>
                <button class="form-action" :disabled="saving">添加预算</button>
              </form>
            </section>

            <section v-else-if="tab === 'checklist'" class="mx-auto max-w-3xl">
              <form class="panel mb-4 flex gap-2" @submit.prevent="addChecklist">
                <input v-model="checklistText" class="min-w-0 flex-1" maxlength="500" placeholder="新增清单事项" aria-label="新增清单事项" />
                <button class="form-action" :disabled="saving">添加</button>
              </form>
              <div class="space-y-2">
                <div v-for="item in selected.checklist" :key="item.id" class="panel flex items-center gap-3">
                  <input :checked="item.completed" class="h-4 w-4 flex-shrink-0" type="checkbox" :aria-label="`切换 ${item.text}`" :disabled="saving" @change="toggleChecklist(item.id)" />
                  <span class="min-w-0 flex-1 break-words" :class="{ 'line-through text-secondary': item.completed }">{{ item.text }}</span>
                  <button type="button" class="icon-button text-error" title="删除清单事项" aria-label="删除清单事项" :disabled="saving" @click="removeNested('checklist', item.id)"><span class="material-symbols-outlined text-[18px]">delete</span></button>
                </div>
                <div v-if="!selected.checklist.length" class="empty-state"><span class="material-symbols-outlined text-4xl">checklist</span><p>还没有清单事项</p></div>
              </div>
            </section>

            <TravelAssetsPanel v-else :trip="selected" :status="status" @trip-changed="applyTrip" @trip-imported="selectImportedTrip" @refresh-requested="refreshTravelAssets" />
          </div>
        </div>
        <div v-else class="flex h-full flex-col items-center justify-center text-center text-secondary"><span class="material-symbols-outlined mb-3 text-5xl text-outline">map</span><p class="font-bold text-on-surface">选择或创建一个行程</p></div>
      </main>
    </div>

    <Teleport to="body">
      <div v-if="candidateOpen" class="fixed inset-0 z-[105] flex justify-end bg-black/25" @click.self="candidateOpen = false">
        <aside role="dialog" aria-modal="true" aria-labelledby="travel-candidates-title" class="flex h-full w-full max-w-5xl flex-col border-l border-outline-variant/30 bg-background shadow-2xl">
          <header class="flex flex-wrap items-start justify-between gap-3 border-b border-outline-variant/25 px-4 py-3 sm:items-center md:px-5">
            <div class="min-w-0 flex-1"><h3 id="travel-candidates-title" class="font-headline text-xl font-bold">旅行候选</h3><p class="mt-1 text-xs text-secondary">{{ candidates.length }} 条候选</p></div>
            <div class="flex w-full min-w-0 flex-wrap items-center justify-end gap-2 sm:w-auto sm:flex-nowrap"><select v-model="candidateImportPrivacy" aria-label="收藏导入隐私范围" class="h-9 min-w-0 flex-1 rounded-lg border-outline-variant/30 bg-surface-bright py-1 pl-3 pr-8 text-xs font-bold sm:flex-none"><option value="private">导入公开与私人</option><option value="secret">导入全部（含机密）</option></select><button type="button" class="flex h-9 flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg bg-primary px-3 text-xs font-bold text-on-primary disabled:opacity-40" :disabled="candidateImporting" @click="importCandidates"><span class="material-symbols-outlined text-[18px]" :class="{ 'animate-spin': candidateImporting }">sync</span>{{ candidateImporting ? '导入中…' : '导入收藏' }}</button><button type="button" class="toolbar flex-shrink-0" aria-label="关闭候选" @click="candidateOpen = false"><span class="material-symbols-outlined">close</span></button></div>
          </header>
          <div v-if="candidateNotice" class="flex items-center justify-between gap-3 border-b border-outline-variant/20 bg-primary-container/20 px-4 py-2 text-xs font-bold text-primary md:px-5"><span class="min-w-0 break-words">{{ candidateNotice }}</span><button type="button" class="icon-button flex-shrink-0" aria-label="关闭通知" @click="candidateNotice = ''"><span class="material-symbols-outlined text-[16px]">close</span></button></div>
          <div v-if="error" class="flex items-start gap-2 border-b border-error/20 bg-error-container/55 px-5 py-2.5 text-xs text-on-error-container"><span class="material-symbols-outlined text-[18px]">error</span><span class="min-w-0 flex-1">{{ error }}</span><button type="button" class="icon-button" aria-label="关闭错误" @click="error = ''"><span class="material-symbols-outlined text-[16px]">close</span></button></div>
          <div class="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[310px_minmax(0,1fr)]">
            <section class="min-h-0 border-r border-outline-variant/25 bg-surface-container-low/45" :class="{ 'hidden md:block': selectedCandidate }">
              <div class="grid grid-cols-3 gap-1 border-b border-outline-variant/20 p-2"><button v-for="item in [{id:'active',label:'待处理'},{id:'added',label:'已加入'},{id:'dismissed',label:'已忽略'}]" :key="item.id" type="button" class="rounded-lg px-2 py-2 text-[11px] font-bold" :class="candidateScope === item.id ? 'bg-primary text-on-primary' : 'text-secondary hover:bg-surface-container-high'" @click="candidateScope = item.id as typeof candidateScope">{{ item.label }}</button></div>
              <div class="h-[calc(100%-3.25rem)] overflow-y-auto p-2">
                <div v-if="candidateLoading" class="empty-state"><span class="material-symbols-outlined animate-spin">progress_activity</span><p>读取候选中…</p></div>
                <button v-for="candidate in visibleCandidates" v-else :key="candidate.id" type="button" class="mb-2 w-full rounded-lg border p-3 text-left" :class="selectedCandidate?.id === candidate.id ? 'border-primary/40 bg-primary-container text-on-primary-container' : 'border-transparent bg-surface-bright hover:border-outline-variant/40'" @click="openCandidate(candidate)"><div class="flex items-start justify-between gap-2"><span class="rounded-full px-2 py-0.5 text-[9px] font-bold" :class="candidate.source === 'xiaomi' ? 'bg-primary-container/30 text-primary' : 'bg-secondary-container text-on-secondary-container'">{{ candidate.source === 'xiaomi' ? '小米笔记' : 'RSS' }}</span><span class="text-[9px] font-bold" :class="candidate.privacy === 'secret' ? 'text-error' : 'opacity-65'">{{ privacyLabel(candidate.privacy) }}</span></div><h4 class="mt-2 line-clamp-2 text-sm font-bold">{{ candidate.title }}</h4><p class="mt-1 line-clamp-2 text-xs opacity-70">{{ candidate.summary || '无摘要' }}</p><div class="mt-2 flex items-center justify-between gap-2 text-[10px] opacity-65"><span class="truncate">{{ candidate.placeName }}</span><span>{{ candidateStatusLabel(candidate.status) }}</span></div></button>
                <div v-if="!candidateLoading && !visibleCandidates.length" class="empty-state"><span class="material-symbols-outlined text-4xl">bookmark_border</span><p>当前列表为空</p></div>
              </div>
            </section>

            <section class="min-h-0" :class="selectedCandidate ? 'block' : 'hidden md:block'">
              <div v-if="selectedCandidate" class="flex h-full min-h-0 flex-col">
                <div class="flex items-center justify-between gap-2 border-b border-outline-variant/20 px-4 py-2"><button type="button" class="toolbar md:hidden" aria-label="返回候选列表" @click="selectedCandidate = undefined"><span class="material-symbols-outlined">arrow_back</span></button><div class="min-w-0 flex-1"><p class="truncate text-xs font-bold text-secondary">{{ selectedCandidate.source === 'xiaomi' ? '小米笔记收藏' : 'RSS 收藏' }} · {{ candidateStatusLabel(selectedCandidate.status) }} · {{ privacyLabel(selectedCandidate.privacy) }}</p></div><button type="button" class="toolbar" title="打开来源" aria-label="打开来源" @click="openCandidateSource(selectedCandidate)"><span class="material-symbols-outlined">open_in_new</span></button><button type="button" class="toolbar text-error" title="删除候选卡" aria-label="删除候选卡" :disabled="candidateSaving" @click="deleteCandidate"><span class="material-symbols-outlined">delete</span></button></div>
                <div class="min-h-0 flex-1 overflow-y-auto p-5 md:p-6">
                  <div class="grid gap-3 md:grid-cols-2"><label class="field md:col-span-2">候选标题<input v-model="candidateForm.title" maxlength="300" /></label><label class="field md:col-span-2">攻略摘要<textarea v-model="candidateForm.summary" maxlength="2000" rows="3"></textarea></label><label class="field">地点名称<input v-model="candidateForm.placeName" maxlength="300" /></label><label class="field">地址<input v-model="candidateForm.address" maxlength="500" /></label><label class="field">纬度<input v-model="candidateForm.latitude" type="number" min="-90" max="90" step="any" /></label><label class="field">经度<input v-model="candidateForm.longitude" type="number" min="-180" max="180" step="any" /></label><label class="field md:col-span-2">标签<input v-model="candidateForm.tags" placeholder="逗号分隔" /></label><label class="field md:col-span-2">行程备注<textarea v-model="candidateForm.notes" maxlength="10000" rows="3"></textarea></label></div>
                  <div class="mt-5 flex flex-wrap items-center gap-2"><button type="button" class="rounded-lg border border-outline-variant/40 px-3 py-2 text-xs font-bold text-primary disabled:opacity-40" :disabled="candidateSaving" @click="saveCandidate()">{{ candidateSaving ? '保存中…' : '保存候选' }}</button><button v-if="selectedCandidate.status !== 'added'" type="button" class="toolbar" :class="selectedCandidate.status === 'saved' ? 'text-tertiary' : ''" title="保留候选" aria-label="保留候选" :disabled="candidateSaving" @click="saveCandidate('saved')"><span class="material-symbols-outlined" :class="{ filled: selectedCandidate.status === 'saved' }">star</span></button><button v-if="selectedCandidate.status !== 'added'" type="button" class="toolbar" title="忽略候选" aria-label="忽略候选" :disabled="candidateSaving" @click="saveCandidate('dismissed')"><span class="material-symbols-outlined">visibility_off</span></button></div>

                  <div class="mt-7 border-t border-outline-variant/25 pt-5"><h4 class="text-sm font-bold text-on-surface">加入行程</h4><div class="mt-3 grid gap-2 md:grid-cols-2"><select :value="candidateTargetTripId" aria-label="目标行程" :disabled="selectedCandidate.status === 'added'" @change="loadCandidateTargetTrip(($event.target as HTMLSelectElement).value)"><option value="">选择行程</option><option v-for="trip in trips.filter((item) => item.status !== 'archived')" :key="trip.id" :value="trip.id">{{ trip.title }} · {{ privacyLabel(trip.privacy) }}</option></select><select v-model="candidateTargetDayId" aria-label="目标日期" :disabled="selectedCandidate.status === 'added' || !candidateTargetTrip"><option value="">选择日期</option><option v-for="day in candidateTargetTrip?.days || []" :key="day.id" :value="day.id">{{ day.date }}{{ day.title ? ` · ${day.title}` : '' }}</option></select></div><p v-if="candidateTargetTrip && !candidateTargetTrip.days.length" class="mt-2 text-xs text-tertiary">该行程还没有日期，请先在日程中添加一天。</p><button type="button" class="mt-3 flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-bold text-on-primary disabled:opacity-40" :disabled="candidateSaving || selectedCandidate.status === 'added' || !candidateTargetTripId || !candidateTargetDayId" @click="addCandidateToTrip"><span class="material-symbols-outlined text-[18px]">add_location_alt</span>{{ selectedCandidate.status === 'added' ? '已加入行程' : '加入所选日期' }}</button></div>
                </div>
              </div>
              <div v-else class="empty-state h-full"><span class="material-symbols-outlined text-5xl">bookmarks</span><p>选择一条旅行候选</p></div>
            </section>
          </div>
        </aside>
      </div>
    </Teleport>

    <Teleport to="body">
      <div v-if="showCreate" class="fixed inset-0 z-[100] flex items-center justify-center bg-black/25 p-4" @click.self="showCreate = false">
        <form role="dialog" aria-modal="true" aria-labelledby="travel-create-title" class="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-lg bg-background p-6 shadow-2xl" @submit.prevent="createTrip">
          <div class="flex items-center justify-between gap-3"><h3 id="travel-create-title" class="font-headline text-xl font-bold">新建行程</h3><button type="button" class="toolbar" aria-label="关闭" @click="showCreate = false"><span class="material-symbols-outlined">close</span></button></div>
          <div class="mt-4 grid gap-3 md:grid-cols-2">
            <label class="field md:col-span-2">名称<input v-model="createForm.title" required maxlength="300" /></label>
            <label class="field">开始<input v-model="createForm.startDate" required type="date" /></label>
            <label class="field">结束<input v-model="createForm.endDate" required type="date" /></label>
            <label class="field">时区<input v-model="createForm.timezone" required /></label>
            <label class="field">货币<input v-model="createForm.currency" required maxlength="3" /></label>
            <label class="field md:col-span-2">描述<textarea v-model="createForm.description" maxlength="10000" rows="3"></textarea></label>
            <label class="field">标签<input v-model="createForm.tags" /></label>
            <label class="field">同行人<input v-model="createForm.travelers" /></label>
          </div>
          <div class="mt-5 flex justify-end gap-2"><button type="button" class="rounded-lg border border-outline-variant/40 px-4 py-2 text-sm font-bold text-secondary" @click="showCreate = false">取消</button><button class="rounded-lg bg-primary px-4 py-2 text-sm font-bold text-on-primary disabled:opacity-40" :disabled="saving">{{ saving ? '创建中…' : '创建' }}</button></div>
        </form>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.toolbar {
  @apply flex h-9 w-9 items-center justify-center rounded-lg text-secondary hover:bg-surface-container-high disabled:cursor-not-allowed disabled:opacity-40;
}
.field {
  @apply flex min-w-0 flex-col gap-2 text-xs font-bold text-secondary;
}
.field :is(input, textarea, select),
.panel :is(input:not([type='checkbox']), select, textarea) {
  @apply min-w-0 rounded-lg border-outline-variant/30 bg-surface-bright text-sm text-on-surface focus:border-primary focus:ring-2 focus:ring-primary;
}
.panel {
  @apply rounded-lg border border-outline-variant/25 bg-surface-container-low p-4;
}
.form-action {
  @apply rounded-lg bg-primary px-3 py-2 text-xs font-bold text-on-primary disabled:cursor-not-allowed disabled:opacity-40;
}
.icon-button {
  @apply flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-transparent p-0 text-secondary hover:bg-surface-container-high disabled:cursor-not-allowed disabled:opacity-40;
}
.stat {
  @apply flex min-w-0 flex-col rounded-lg bg-surface-container-low p-4;
}
.stat b {
  @apply break-words text-lg text-on-surface;
}
.stat span {
  @apply mt-1 text-xs text-secondary;
}
.empty-state {
  @apply flex min-h-40 flex-col items-center justify-center gap-2 text-center text-sm text-secondary;
}
</style>
