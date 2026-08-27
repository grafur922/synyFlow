<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import {
  AlertCircle,
  X,
  CheckCircle2,
  MapPinOff,
  Route,
  Navigation,
  Paperclip,
  FileText,
  Download,
  Trash2,
  FileX,
  Eye,
  EyeOff,
  Archive,
  Upload
} from 'lucide-vue-next'
import { travelApi } from '../../services/travelApi'
import type {
  Trip,
  TravelAttachmentScope,
  TravelMapProvider,
  TravelMapProviderInfo,
  TravelMapTarget,
  TravelStatus
} from '../../shared/travel'

const props = defineProps<{ trip: Trip; status?: TravelStatus }>()
const emit = defineEmits<{
  tripChanged: [trip: Trip]
  tripImported: [trip: Trip]
  refreshRequested: []
}>()

const provider = ref<TravelMapProvider>(readProvider())
const providers = ref<TravelMapProviderInfo[]>([])
const attachmentTarget = ref('trip')
const packagePassphrase = ref('')
const showPackagePassphrase = ref(false)
const busy = ref(false)
const error = ref('')
const notice = ref('')

const places = computed(() => props.trip.days.flatMap((day) => day.places.map((place) => ({ day, place }))))
const selectedProvider = computed(() => providers.value.find((item) => item.id === provider.value))
const attachmentTargets = computed(() => [
  { value: 'trip', label: '整个行程' },
  ...props.trip.days.map((day) => ({ value: `day:${day.id}`, label: `${day.date} · ${day.title || '当天'}` })),
  ...places.value.map(({ day, place }) => ({ value: `place:${place.id}`, label: `${day.date} · ${place.name}` })),
  ...props.trip.bookings.map((booking) => ({ value: `booking:${booking.id}`, label: `预订 · ${booking.title}` }))
])

onMounted(async () => {
  try {
    providers.value = await travelApi.getMapProviders()
    if (!providers.value.some((item) => item.id === provider.value)) provider.value = providers.value[0]?.id || 'osm'
  } catch (cause) {
    error.value = messageFrom(cause)
  }
})

watch(() => props.trip.id, () => {
  attachmentTarget.value = 'trip'
  error.value = ''
  notice.value = ''
})

function selectProvider(value: TravelMapProvider) {
  provider.value = value
  localStorage.setItem('terra_travel_map_provider', value)
}

async function openPlace(target: TravelMapTarget) {
  await openMap({ provider: provider.value, kind: 'place', target })
}

async function openSegment(segment: Trip['segments'][number]) {
  const origin = targetFor(segment.fromPlaceId, segment.fromName)
  const destination = targetFor(segment.toPlaceId, segment.toName)
  await openMap({ provider: provider.value, kind: 'route', origin, destination, mode: segment.mode })
}

function providerSupportsRoute(mode: Trip['segments'][number]['mode']) {
  return Boolean(selectedProvider.value?.routeLinks && selectedProvider.value.routeModes.includes(mode))
}

async function openMap(input: Parameters<typeof travelApi.createMapLink>[0]) {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    const result = await travelApi.createMapLink(input)
    await openExternal(result.url)
  } catch (cause) {
    error.value = messageFrom(cause)
  } finally {
    busy.value = false
  }
}

function targetFor(placeId: string | undefined, fallbackName: string): TravelMapTarget {
  const place = placeId ? places.value.find((item) => item.place.id === placeId)?.place : undefined
  return place ? { name: place.name, address: place.address, location: place.location } : { name: fallbackName }
}

async function uploadAttachment(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || busy.value) return
  if (file.size < 1 || file.size > 8 * 1024 * 1024) {
    error.value = '单个附件必须在 1 字节到 8 MB 之间'
    return
  }
  const [scope, scopeId] = attachmentTarget.value.split(':', 2) as [TravelAttachmentScope, string | undefined]
  busy.value = true
  error.value = ''
  try {
    const result = await travelApi.uploadAttachment(props.trip.id, file, scope, scopeId)
    emit('tripChanged', result.trip)
    emit('refreshRequested')
    notice.value = '附件已加密保存'
  } catch (cause) {
    error.value = messageFrom(cause)
  } finally {
    busy.value = false
  }
}

async function downloadAttachment(attachment: Trip['attachments'][number]) {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    const blob = await travelApi.downloadAttachment(props.trip.id, attachment.id)
    downloadBlob(blob, attachment.filename)
  } catch (cause) {
    error.value = messageFrom(cause)
  } finally {
    busy.value = false
  }
}

async function removeAttachment(attachment: Trip['attachments'][number]) {
  if (busy.value || !window.confirm(`删除附件“${attachment.filename}”吗？`)) return
  busy.value = true
  error.value = ''
  try {
    const result = await travelApi.removeAttachment(props.trip.id, attachment.id)
    emit('tripChanged', result.trip)
    emit('refreshRequested')
    notice.value = '附件已删除'
  } catch (cause) {
    error.value = messageFrom(cause)
  } finally {
    busy.value = false
  }
}

async function exportOfflinePackage() {
  if (busy.value || !validPassphrase()) return
  busy.value = true
  error.value = ''
  try {
    const blob = await travelApi.exportOfflinePackage(props.trip.id, packagePassphrase.value)
    downloadBlob(blob, `${safeFilename(props.trip.title) || props.trip.id}.terra-trip`)
    notice.value = '离线行程包已导出'
  } catch (cause) {
    error.value = messageFrom(cause)
  } finally {
    busy.value = false
  }
}

async function importOfflinePackage(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || busy.value || !validPassphrase()) return
  if (file.size < 1 || file.size > 64 * 1024 * 1024) {
    error.value = '离线行程包必须小于 64 MB'
    return
  }
  busy.value = true
  error.value = ''
  try {
    const trip = await travelApi.importOfflinePackage(file, packagePassphrase.value)
    emit('tripImported', trip)
    emit('refreshRequested')
    notice.value = '离线行程包已导入'
  } catch (cause) {
    error.value = messageFrom(cause)
  } finally {
    busy.value = false
  }
}

function validPassphrase() {
  if (packagePassphrase.value.length >= 16 && packagePassphrase.value.length <= 1024) return true
  error.value = '离线包口令需要 16 到 1024 个字符'
  return false
}

function scopeLabel(attachment: Trip['attachments'][number]) {
  if (attachment.scope === 'trip') return '整个行程'
  if (attachment.scope === 'day') return props.trip.days.find((day) => day.id === attachment.scopeId)?.date || '行程日期'
  if (attachment.scope === 'place') return places.value.find((item) => item.place.id === attachment.scopeId)?.place.name || '行程地点'
  return props.trip.bookings.find((item) => item.id === attachment.scopeId)?.title || '行程预订'
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(value < 10 * 1024 ? 1 : 0)} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

async function openExternal(url: string) {
  if ('__TAURI_INTERNALS__' in window) {
    const { openUrl } = await import('@tauri-apps/plugin-opener')
    await openUrl(url)
  } else {
    window.open(url, '_blank', 'noopener,noreferrer')
  }
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

function readProvider(): TravelMapProvider {
  const stored = localStorage.getItem('terra_travel_map_provider')
  return stored === 'amap' || stored === 'apple' || stored === 'google' || stored === 'osm' ? stored : 'amap'
}

function safeFilename(value: string) {
  return value.trim().replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').replace(/[. ]+$/g, '').slice(0, 100)
}

function messageFrom(cause: unknown) {
  return cause instanceof Error ? cause.message : '操作失败'
}
</script>

<template>
  <div class="mx-auto max-w-5xl">
    <div v-if="error" role="alert" class="mb-5 flex items-start gap-2 rounded-lg bg-error-container/60 p-3 text-sm text-on-error-container">
      <AlertCircle class="h-5 w-5 text-on-error-container flex-shrink-0" :stroke-width="2" />
      <span class="min-w-0 flex-1 break-words">{{ error }}</span>
      <button type="button" class="icon-button" aria-label="关闭" @click="error = ''">
        <X class="h-4.5 w-4.5" :stroke-width="2" />
      </button>
    </div>
    <div v-else-if="notice" role="status" class="mb-5 flex items-center gap-2 border-l-2 border-primary bg-primary-container/20 px-3 py-2 text-xs font-bold text-primary">
      <CheckCircle2 class="h-4.5 w-4.5" :stroke-width="2" />
      <span>{{ notice }}</span>
    </div>

    <section class="pb-7">
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div><h3 class="font-headline text-lg font-bold">地图</h3><p class="mt-1 text-xs text-secondary">{{ places.length }} 个地点 · {{ trip.segments.length }} 段交通</p></div>
        <div class="flex max-w-full overflow-x-auto rounded-lg border border-outline-variant/30 bg-surface-container-low p-1" role="group" aria-label="地图供应商">
          <button v-for="item in providers" :key="item.id" type="button" class="h-8 whitespace-nowrap rounded-md px-3 text-xs font-bold" :class="provider === item.id ? 'bg-primary text-on-primary' : 'text-secondary hover:bg-surface-bright'" :aria-pressed="provider === item.id" @click="selectProvider(item.id)">{{ item.label }}</button>
        </div>
      </div>

      <div v-if="places.length" class="route-strip no-scrollbar mt-6 flex min-h-24 gap-0 overflow-x-auto pb-2">
        <button v-for="({ day, place }, index) in places" :key="place.id" type="button" class="route-stop group relative flex w-40 flex-shrink-0 flex-col items-start px-3 pt-9 text-left" :disabled="busy" @click="openPlace({ name: place.name, address: place.address, location: place.location })">
          <span class="route-dot absolute left-3 top-3 z-10 flex h-6 w-6 items-center justify-center rounded-full border-2 border-primary bg-background text-[10px] font-bold text-primary">{{ index + 1 }}</span>
          <b class="line-clamp-2 text-sm text-on-surface group-hover:text-primary">{{ place.name }}</b>
          <span class="mt-1 text-[10px] text-secondary">{{ day.date }} · {{ place.startTime || '--:--' }}</span>
        </button>
      </div>
      <div v-else class="empty-row mt-5">
        <MapPinOff class="h-5 w-5 text-secondary" :stroke-width="1.8" />
        <span>还没有行程地点</span>
      </div>

      <div v-if="trip.segments.length" class="mt-5 divide-y divide-outline-variant/20 border-y border-outline-variant/25">
        <div v-for="segment in trip.segments" :key="segment.id" class="flex min-h-14 items-center gap-3 py-2.5">
          <Route class="h-5 w-5 text-primary flex-shrink-0" :stroke-width="2" />
          <div class="min-w-0 flex-1"><p class="truncate text-sm font-bold">{{ segment.fromName }} → {{ segment.toName }}</p><p class="mt-0.5 text-[10px] text-secondary">{{ segment.distanceKm === undefined ? '距离未定' : `${segment.distanceKm} km` }}</p></div>
          <button v-if="providerSupportsRoute(segment.mode)" type="button" class="icon-button" title="打开路线" aria-label="打开路线" :disabled="busy" @click="openSegment(segment)">
            <Navigation class="h-4.5 w-4.5" :stroke-width="1.8" />
          </button>
        </div>
      </div>
    </section>

    <section class="border-t border-outline-variant/30 py-7">
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div><h3 class="font-headline text-lg font-bold">附件</h3><p class="mt-1 text-xs text-secondary">{{ trip.attachments.length }} 个 · {{ formatBytes(trip.attachments.reduce((sum, item) => sum + item.size, 0)) }}</p></div>
        <div class="flex min-w-0 flex-wrap items-center justify-end gap-2">
          <select v-model="attachmentTarget" class="h-9 min-w-0 max-w-60 rounded-lg border-outline-variant/30 bg-surface-bright py-1 pl-3 pr-8 text-xs font-bold" aria-label="附件归属"><option v-for="target in attachmentTargets" :key="target.value" :value="target.value">{{ target.label }}</option></select>
          <label class="action-button cursor-pointer border border-outline-variant/40 text-primary" :class="{ 'pointer-events-none opacity-40': busy || !status?.attachmentStoreAvailable }">
            <Paperclip class="h-4 w-4" :stroke-width="2" />
            <span>添加</span>
            <input type="file" class="hidden" @change="uploadAttachment" />
          </label>
        </div>
      </div>
      <p v-if="status && !status.attachmentStoreAvailable" class="mt-4 rounded-lg bg-error-container/50 px-3 py-2 text-xs text-on-error-container">{{ status.attachmentStoreMessage }}</p>
      <div v-if="trip.attachments.length" class="mt-5 grid gap-2 sm:grid-cols-2">
        <article v-for="attachment in trip.attachments" :key="attachment.id" class="flex min-h-20 items-center gap-3 rounded-lg border border-outline-variant/25 bg-surface-bright p-3">
          <span class="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-surface-container-high text-primary">
            <FileText class="h-4.5 w-4.5" :stroke-width="2" />
          </span>
          <div class="min-w-0 flex-1"><p class="truncate text-sm font-bold" :title="attachment.filename">{{ attachment.filename }}</p><p class="mt-1 truncate text-[10px] text-secondary">{{ scopeLabel(attachment) }} · {{ formatBytes(attachment.size) }}</p></div>
          <button type="button" class="icon-button" title="下载附件" aria-label="下载附件" :disabled="busy" @click="downloadAttachment(attachment)">
            <Download class="h-4.5 w-4.5" :stroke-width="2" />
          </button>
          <button type="button" class="icon-button text-error" title="删除附件" aria-label="删除附件" :disabled="busy" @click="removeAttachment(attachment)">
            <Trash2 class="h-4.5 w-4.5" :stroke-width="2" />
          </button>
        </article>
      </div>
      <div v-else class="empty-row mt-5">
        <FileX class="h-5 w-5 text-secondary" :stroke-width="1.8" />
        <span>还没有附件</span>
      </div>
    </section>

    <section class="border-t border-outline-variant/30 py-7">
      <div><h3 class="font-headline text-lg font-bold">离线行程包</h3><p class="mt-1 text-xs text-secondary">{{ trip.title }} · {{ trip.startDate }} → {{ trip.endDate }}</p></div>
      <label class="mt-5 block max-w-xl text-xs font-bold text-secondary">行程包口令
        <span class="mt-2 flex items-center rounded-lg border border-outline-variant/30 bg-surface-bright focus-within:ring-2 focus-within:ring-primary">
          <input v-model="packagePassphrase" :type="showPackagePassphrase ? 'text' : 'password'" minlength="16" maxlength="1024" autocomplete="new-password" class="min-w-0 flex-1 border-0 bg-transparent text-sm focus:ring-0" />
          <button type="button" class="flex h-10 w-10 items-center justify-center text-secondary" :aria-label="showPackagePassphrase ? '隐藏口令' : '显示口令'" @click="showPackagePassphrase = !showPackagePassphrase">
            <EyeOff v-if="showPackagePassphrase" class="h-4.5 w-4.5" :stroke-width="1.8" />
            <Eye v-else class="h-4.5 w-4.5" :stroke-width="1.8" />
          </button>
        </span>
      </label>
      <div class="mt-4 flex flex-wrap gap-2">
        <button type="button" class="action-button bg-primary text-on-primary" :disabled="busy" @click="exportOfflinePackage">
          <Archive class="h-4 w-4" :stroke-width="2" />
          <span>导出行程包</span>
        </button>
        <label class="action-button cursor-pointer border border-outline-variant/40 text-primary" :class="{ 'pointer-events-none opacity-40': busy }">
          <Upload class="h-4 w-4" :stroke-width="2" />
          <span>导入行程包</span>
          <input type="file" class="hidden" accept=".terra-trip,application/vnd.terra.trip+json" @change="importOfflinePackage" />
        </label>
      </div>
    </section>
  </div>
</template>

<style scoped>
.route-strip {
  position: relative;
}
.route-strip::before {
  content: '';
  position: absolute;
  left: 1.5rem;
  right: 1.5rem;
  top: 1.5rem;
  height: 2px;
  background: color-mix(in srgb, var(--color-primary) 28%, transparent);
}
.route-dot {
  transition: background-color 160ms ease, color 160ms ease;
}
.route-stop:hover .route-dot {
  background: rgb(var(--md-sys-color-primary));
  color: rgb(var(--md-sys-color-on-primary));
}
.icon-button {
  @apply flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-transparent p-0 text-secondary hover:bg-surface-container-high disabled:cursor-not-allowed disabled:opacity-40;
}
.action-button {
  @apply flex h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-bold transition disabled:cursor-not-allowed disabled:opacity-40;
}
.empty-row {
  @apply flex min-h-20 items-center justify-center gap-2 border-y border-dashed border-outline-variant/30 text-xs text-secondary;
}
@media (prefers-reduced-motion: reduce) {
  .route-dot { transition: none; }
}
</style>
