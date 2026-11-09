import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import {
  Activity, ArrowDownRight, ArrowUpRight, Bell, CalendarDays, CheckCircle2, ChevronDown,
  CircleAlert, CircleDollarSign, ClipboardList, Clock3, Egg, FileText, HeartPulse,
  LayoutDashboard, Leaf, LogOut, Mail, MapPin, Menu, Package, Pencil, Phone, Plus, Ruler, Search, Settings, ShieldCheck,
  ShoppingCart, Sprout, TrendingUp, Users, Wheat, X, Beef, PawPrint, Milk
} from 'lucide-react'
import { supabase, supabaseReady } from './supabase'

type ModuleKey = 'Dashboard' | 'Livestock' | 'Poultry' | 'Health & Breeding' | 'Breeding Records' | 'Feed & Inventory' | 'Feed Logs' | 'Production' | 'Sales' | 'Purchases' | 'Expenses' | 'Tasks' | 'Customers' | 'Suppliers'
type PageKey = ModuleKey | 'Manage Farms'
type Row = Record<string, any>
type SaleItemDraft = {
  key: string
  item_type: string
  description: string
  livestock_id: string
  poultry_batch_id: string
  quantity: string
  unit: string
  unit_price: string
}
type FarmValues = { name: string; location: string; phone: string; email: string; currency: string; area_acres: string; notes: string }
type ReportingPeriod = 'week' | 'month' | 'last-month' | 'quarter' | 'year' | 'custom'
type DateRange = { start: Date; end: Date }
type DashboardData = {
  loading: boolean
  failedTables: string[]
  sales: Row[]
  outstandingSales: Row[]
  expenses: Row[]
  livestock: Row[]
  poultry: Row[]
  health: Row[]
  production: Row[]
  feedInventory: Row[]
  feedLogs: Row[]
  feedUsageLogs: Row[]
  tasks: Row[]
  recentSales: Row[]
  customers: Row[]
}

const localDateString = (date: Date) => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
const newSaleItemDraft = (): SaleItemDraft => ({
  key: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  item_type: '',
  description: '',
  livestock_id: '',
  poultry_batch_id: '',
  quantity: '',
  unit: '',
  unit_price: ''
})
const periodRange = (period: ReportingPeriod, customStart: string, customEnd: string): DateRange => {
  const today = new Date()
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1)
  if (period === 'custom') {
    const start = new Date(`${customStart}T00:00:00`)
    const customLastDay = new Date(`${customEnd}T00:00:00`)
    return { start, end: new Date(customLastDay.getFullYear(), customLastDay.getMonth(), customLastDay.getDate() + 1) }
  }
  if (period === 'week') {
    const daysSinceMonday = (today.getDay() + 6) % 7
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - daysSinceMonday)
    return { start, end }
  }
  if (period === 'month') return { start: new Date(today.getFullYear(), today.getMonth(), 1), end }
  if (period === 'last-month') return { start: new Date(today.getFullYear(), today.getMonth() - 1, 1), end: new Date(today.getFullYear(), today.getMonth(), 1) }
  if (period === 'quarter') return { start: new Date(today.getFullYear(), today.getMonth() - 2, 1), end }
  return { start: new Date(today.getFullYear(), 0, 1), end }
}
const previousRange = ({ start, end }: DateRange): DateRange => {
  const duration = end.getTime() - start.getTime()
  return { start: new Date(start.getTime() - duration), end: start }
}
const sumAmount = (rows: Row[], field: string) => rows.reduce((sum, row) => sum + (Number(row[field]) || 0), 0)
const dateRangeLabel = (range: DateRange) => Number.isNaN(range.start.getTime()) || Number.isNaN(range.end.getTime())
  ? 'Choose a valid date range'
  : `${dateLabel(localDateString(range.start))} – ${dateLabel(localDateString(new Date(range.end.getTime() - 86400000)))}`
async function queryFarmRows(table: string, ownerId: string, farmId: string, dateFilter?: { field: string; from: string; until: string }, valueFilter?: { field: string; values: string[] }) {
  const pageSize = 1000
  const rows: Row[] = []
  for (let offset = 0; ; offset += pageSize) {
    let query = supabase.from(table).select('*').eq('owner_id', ownerId).eq('farm_id', farmId)
    if (dateFilter) query = query.gte(dateFilter.field, dateFilter.from).lt(dateFilter.field, dateFilter.until)
    if (valueFilter) query = query.in(valueFilter.field, valueFilter.values)
    const { data, error } = await query.order('id', { ascending: true }).range(offset, offset + pageSize - 1)
    if (error) return { data: rows, error }
    const page = data || []
    rows.push(...page)
    if (page.length < pageSize) return { data: rows, error: null }
  }
}
async function verifyFarmRecordIds(table: string, ownerId: string, farmId: string, ids: string[]) {
  const uniqueIds = [...new Set(ids.filter(Boolean))]
  if (!uniqueIds.length) return true
  const { data, error } = await supabase.from(table).select('id').eq('owner_id', ownerId).eq('farm_id', farmId).in('id', uniqueIds)
  if (error) throw new Error(`Unable to verify selected ${table} records: ${error.message}`)
  return (data || []).length === uniqueIds.length
}
async function queryFeedUsageRows(ownerId: string, farmId: string, from: string, until: string) {
  const result = await queryFarmRows('feed_logs', ownerId, farmId, { field: 'feed_on', from, until })
  if (!result.error || !result.error.message.toLowerCase().includes('feed_on')) return result
  return queryFarmRows('feed_logs', ownerId, farmId, { field: 'fed_on', from, until })
}
async function queryRecentFeedLogs(ownerId: string, farmId: string) {
  const query = (dateField: 'feed_on' | 'fed_on') =>
    supabase.from('feed_logs').select('*').eq('owner_id', ownerId).eq('farm_id', farmId).order(dateField, { ascending: false }).limit(10)
  const result = await query('feed_on')
  if (!result.error || !result.error.message.toLowerCase().includes('feed_on')) return result
  return query('fed_on')
}
const navigation: { label: ModuleKey; icon: any; group: string }[] = [
  { label: 'Dashboard', icon: LayoutDashboard, group: 'OVERVIEW' },
  { label: 'Livestock', icon: Beef, group: 'LIVESTOCK' },
  { label: 'Poultry', icon: Egg, group: 'LIVESTOCK' },
  { label: 'Health & Breeding', icon: HeartPulse, group: 'LIVESTOCK' },
  { label: 'Breeding Records', icon: PawPrint, group: 'LIVESTOCK' },
  { label: 'Feed & Inventory', icon: Wheat, group: 'OPERATIONS' },
  { label: 'Feed Logs', icon: ClipboardList, group: 'OPERATIONS' },
  { label: 'Production', icon: Sprout, group: 'OPERATIONS' },
  { label: 'Sales', icon: ShoppingCart, group: 'FINANCE' },
  { label: 'Purchases', icon: Package, group: 'FINANCE' },
  { label: 'Customers', icon: Users, group: 'FINANCE' },
  { label: 'Suppliers', icon: Package, group: 'FINANCE' },
  { label: 'Expenses', icon: CircleDollarSign, group: 'FINANCE' },
  { label: 'Tasks', icon: ClipboardList, group: 'OPERATIONS' },
]
const moduleTables: Partial<Record<ModuleKey, string>> = {
  Livestock: 'livestock', Poultry: 'poultry_batches', 'Health & Breeding': 'health_records', 'Breeding Records': 'breeding_records',
  'Feed & Inventory': 'feed_inventory', 'Feed Logs': 'feed_logs', Production: 'production_records', Sales: 'sales',
  Purchases: 'purchases', Customers: 'customers', Suppliers: 'suppliers', Expenses: 'expenses', Tasks: 'farm_tasks'
}
const currency = (value: number) => new Intl.NumberFormat('en-UG', { style: 'currency', currency: 'UGX', maximumFractionDigits: 0 }).format(value || 0)
const dateLabel = (v?: string) => v ? new Date(v).toLocaleDateString('en-UG', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'

export default function App() {
  const [session, setSession] = useState<any>(null)
  const [loadingAuth, setLoadingAuth] = useState(true)
  const [active, setActive] = useState<PageKey>('Dashboard')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [userName, setUserName] = useState('Farm Owner')
  const [farms, setFarms] = useState<Row[]>([])
  const [farmsLoading, setFarmsLoading] = useState(true)
  const [selectedFarmId, setSelectedFarmId] = useState('')
  const farm = farms.find(item => item.id === selectedFarmId) || null
  const [period, setPeriod] = useState<ReportingPeriod>('month')
  const today = localDateString(new Date())
  const [customStart, setCustomStart] = useState(localDateString(new Date(new Date().getFullYear(), new Date().getMonth(), 1)))
  const [customEnd, setCustomEnd] = useState(today)
  const [dashboardData, setDashboardData] = useState<DashboardData>({
    loading: false, failedTables: [], sales: [], outstandingSales: [], expenses: [], livestock: [], poultry: [], health: [],
    production: [], feedInventory: [], feedLogs: [], feedUsageLogs: [], tasks: [], recentSales: [], customers: []
  })
  const [rows, setRows] = useState<Row[]>([])
  const [busy, setBusy] = useState(false)
  const moduleLoadRequest = useRef(0)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [modal, setModal] = useState(false)
  const [editingRecord, setEditingRecord] = useState<Row | null>(null)
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login')
  const [authEmail, setAuthEmail] = useState('')
  const [authPassword, setAuthPassword] = useState('')
  const [authBusy, setAuthBusy] = useState(false)
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (!supabaseReady) { setLoadingAuth(false); return }
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setLoadingAuth(false) })
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession))
    return () => data.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (session?.user) {
      setUserName(session.user.user_metadata?.full_name || session.user.email?.split('@')[0] || 'Farm Owner')
    }
  }, [session])

  useEffect(() => {
    if (!session?.user?.id) {
      setFarms([])
      setSelectedFarmId('')
      setFarmsLoading(false)
      return
    }
    let cancelled = false
    setFarmsLoading(true)
    setFarms([])
    setSelectedFarmId('')
    async function loadFarms() {
      try {
        const { data, error: queryError } = await supabase.from('farms').select('*').eq('owner_id', session.user.id).order('name', { ascending: true })
        if (cancelled) return
        if (queryError) {
          setError(`Unable to load farms: ${queryError.message}`)
          setFarmsLoading(false)
          return
        }
        const availableFarms = data || []
        setFarms(availableFarms)
        let storedFarmId = ''
        try {
          storedFarmId = window.localStorage.getItem(`farmpro:selectedFarm:${session.user.id}`) || ''
        } catch (storageError) {
          setError(`Unable to restore the saved farm selection: ${storageError instanceof Error ? storageError.message : String(storageError)}`)
        }
        setSelectedFarmId(availableFarms.some(item => item.id === storedFarmId) ? storedFarmId : availableFarms[0]?.id || '')
        setFarmsLoading(false)
      } catch (loadError) {
        if (!cancelled) {
          setError(`Unable to load farms: ${loadError instanceof Error ? loadError.message : String(loadError)}`)
          setFarmsLoading(false)
        }
      }
    }
    void loadFarms()
    return () => { cancelled = true }
  }, [session])

  useEffect(() => {
    if (!session?.user?.id || !selectedFarmId || !farms.some(item => item.id === selectedFarmId)) return
    try {
      window.localStorage.setItem(`farmpro:selectedFarm:${session.user.id}`, selectedFarmId)
    } catch (storageError) {
      setError(`Unable to save the selected farm on this device: ${storageError instanceof Error ? storageError.message : String(storageError)}`)
    }
  }, [session, selectedFarmId, farms])

  useEffect(() => {
    if (session?.user && active !== 'Dashboard' && active !== 'Manage Farms') void loadModule(active)
    else if (active === 'Manage Farms') {
      moduleLoadRequest.current += 1
      setRows([])
      setBusy(false)
    }
  }, [active, session, selectedFarmId])

  useEffect(() => {
    if (!session?.user?.id || !selectedFarmId) {
      setDashboardData({
        loading: false, failedTables: [], sales: [], outstandingSales: [], expenses: [], livestock: [],
        poultry: [], health: [], production: [], feedInventory: [], feedLogs: [], feedUsageLogs: [], tasks: [], recentSales: [], customers: []
      })
      return
    }
    const range = periodRange(period, customStart, customEnd)
    if (Number.isNaN(range.start.getTime()) || Number.isNaN(range.end.getTime()) || range.start >= range.end) {
      setError('Choose a valid custom reporting range.')
      setDashboardData({
        loading: false, failedTables: [], sales: [], outstandingSales: [], expenses: [], livestock: [],
        poultry: [], health: [], production: [], feedInventory: [], feedLogs: [], feedUsageLogs: [], tasks: [], recentSales: [], customers: []
      })
      return
    }
    let cancelled = false
    async function loadDashboard() {
      setDashboardData({
        loading: true, failedTables: [], sales: [], outstandingSales: [], expenses: [], livestock: [],
        poultry: [], health: [], production: [], feedInventory: [], feedLogs: [], feedUsageLogs: [], tasks: [], recentSales: [], customers: []
      })
      setError('')
      try {
      const uid = session.user.id
      const previous = previousRange(range)
      const from = localDateString(previous.start)
      const periodFrom = localDateString(range.start)
      const until = localDateString(range.end)
      const farmQuery = (table: string) => supabase.from(table).select('*').eq('owner_id', uid).eq('farm_id', selectedFarmId)
      const remindersThrough = localDateString(new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate() + 7))
      const [salesResult, outstandingResult, expensesResult, livestockResult, poultryResult, healthResult, productionResult, feedInventoryResult, feedLogsResult, feedUsageResult, tasksResult, recentSalesResult] = await Promise.all([
        queryFarmRows('sales', uid, selectedFarmId, { field: 'sale_date', from, until }),
        queryFarmRows('sales', uid, selectedFarmId, undefined, { field: 'status', values: ['part_paid', 'unpaid'] }),
        queryFarmRows('expenses', uid, selectedFarmId, { field: 'expense_date', from, until }),
        queryFarmRows('livestock', uid, selectedFarmId),
        queryFarmRows('poultry_batches', uid, selectedFarmId),
        farmQuery('health_records').lte('next_due_date', remindersThrough).order('next_due_date', { ascending: true }).limit(100),
        queryFarmRows('production_records', uid, selectedFarmId, { field: 'recorded_on', from, until }),
        queryFarmRows('feed_inventory', uid, selectedFarmId),
        queryRecentFeedLogs(uid, selectedFarmId),
        queryFeedUsageRows(uid, selectedFarmId, periodFrom, until),
        queryFarmRows('farm_tasks', uid, selectedFarmId),
        farmQuery('sales').order('sale_date', { ascending: false }).limit(6)
      ])
      if (cancelled) return
      const results = [
        ['sales', salesResult], ['outstanding payments', outstandingResult], ['expenses', expensesResult], ['livestock', livestockResult],
        ['poultry batches', poultryResult], ['health records', healthResult],
        ['production records', productionResult], ['feed inventory', feedInventoryResult],
        ['feed logs', feedLogsResult], ['feed usage', feedUsageResult], ['tasks', tasksResult], ['recent sales', recentSalesResult]
      ] as const
      const failures = results.filter(([, result]) => result.error).map(([table, result]) => `${table}: ${result.error!.message}`)
      if (failures.length) setError(`Some dashboard data could not be loaded. ${failures.join(' ')}`)
      const sales = salesResult.data || []
      const recentSales = recentSalesResult.data || []
      let customers: Row[] = []
      const customerIds = [...new Set([...sales, ...recentSales].map((sale: Row) => sale.customer_id).filter(Boolean))]
      if (customerIds.length) {
        const { data, error: customerError } = await supabase.from('customers').select('id, name').eq('owner_id', uid).eq('farm_id', selectedFarmId).in('id', customerIds)
        if (cancelled) return
        customers = data || []
        if (customerError) setError(current => `${current ? `${current} ` : ''}Customer names are unavailable: ${customerError.message}`)
      }
      setDashboardData({
        loading: false, failedTables: failures.map(failure => failure.split(':')[0]), sales,
        outstandingSales: outstandingResult.data || [], expenses: expensesResult.data || [], livestock: livestockResult.data || [],
        poultry: poultryResult.data || [], health: healthResult.data || [], production: productionResult.data || [],
        feedInventory: feedInventoryResult.data || [], feedLogs: feedLogsResult.data || [], feedUsageLogs: feedUsageResult.data || [],
        tasks: tasksResult.data || [], recentSales, customers
      })
      } catch (loadError) {
        if (cancelled) return
        setError(`Unable to load dashboard data: ${loadError instanceof Error ? loadError.message : String(loadError)}`)
        setDashboardData(current => ({ ...current, loading: false }))
      }
    }
    void loadDashboard()
    return () => { cancelled = true }
  }, [session, selectedFarmId, period, customStart, customEnd])

  async function loadModule(module: ModuleKey) {
    const table = moduleTables[module]
    const requestId = ++moduleLoadRequest.current
    const ownerId = session?.user?.id
    const farmId = selectedFarmId
    if (!table || !ownerId || !farmId) {
      setRows([])
      setBusy(false)
      return
    }
    setBusy(true); setError('')
    setRows([])
    if (module === 'Breeding Records') {
      const [recordsResult, livestockResult, poultryResult] = await Promise.all([
        supabase.from('breeding_records').select('*').eq('owner_id', ownerId).eq('farm_id', farmId).order('created_at', { ascending: false }).limit(100),
        supabase.from('livestock').select('id, tag_number, name, species, sex').eq('owner_id', ownerId).eq('farm_id', farmId),
        supabase.from('poultry_batches').select('id, batch_name, bird_type').eq('owner_id', ownerId).eq('farm_id', farmId)
      ])
      if (requestId !== moduleLoadRequest.current) return
      if ([recordsResult, livestockResult, poultryResult].some(result => result.error)) {
        setError([recordsResult.error?.message, livestockResult.error?.message, poultryResult.error?.message].filter(Boolean).join(' '))
      }
      const livestockNames = new Map((livestockResult.data || []).map((item: Row) => [item.id, item.tag_number || item.name || item.species]))
      const poultryNames = new Map((poultryResult.data || []).map((item: Row) => [item.id, item.batch_name || item.bird_type]))
      const recordRows = (recordsResult.data || []).map((record: Row) => {
        const dam = livestockNames.get(record.dam_livestock_id)
        const sire = livestockNames.get(record.sire_livestock_id)
        const poultry = poultryNames.get(record.poultry_batch_id)
        const linked = [dam ? `Dam: ${dam}` : '', sire ? `Sire: ${sire}` : '', poultry ? `Batch: ${poultry}` : ''].filter(Boolean).join(' · ') || '—'
        return { ...record, linked_name: linked }
      })
      setRows(recordRows)
      setBusy(false)
      return
    }
    if (module === 'Livestock') {
      const { data: livestockResult, error: livestockError } = await supabase.from('livestock')
        .select('*')
        .eq('owner_id', ownerId)
        .eq('farm_id', farmId)
        .order('created_at', { ascending: false })
        .limit(100)
      if (requestId !== moduleLoadRequest.current) return
      if (livestockError) {
        setError(livestockError.message)
        setRows([])
        setBusy(false)
        return
      }
      const livestockRows = livestockResult || []
      const parentIds = [...new Set(livestockRows.flatMap((animal: Row) => [animal.dam_id, animal.sire_id]).filter(Boolean))]
      const { data: parentRows, error: parentError } = parentIds.length
        ? await supabase.from('livestock').select('id, tag_number, name').eq('owner_id', ownerId).eq('farm_id', farmId).in('id', parentIds)
        : { data: [], error: null }
      if (requestId !== moduleLoadRequest.current) return
      if (parentError) setError(`Parent details could not be loaded: ${parentError.message}`)
      const parentsById = new Map((parentRows || []).map((animal: Row) => [animal.id, animal]))
      setRows(livestockRows.map((animal: Row) => {
        const dam = parentsById.get(animal.dam_id)
        const sire = parentsById.get(animal.sire_id)
        return {
          ...animal,
          maternal_lineage: dam ? `Dam: ${dam.tag_number}${dam.name ? ` — ${dam.name}` : ''}` : 'Unknown mother',
          parent_lineage: [
            dam ? `Mother: ${dam.tag_number}` : '',
            sire ? `Father: ${sire.tag_number}` : ''
          ].filter(Boolean).join(' · ') || 'No parent details'
        }
      }))
      setBusy(false)
      return
    }
    if (module === 'Feed Logs') {
      const [logsResult, farmResult, inventoryResult, livestockResult, poultryResult] = await Promise.all([
        queryRecentFeedLogs(ownerId, farmId),
        supabase.from('farms').select('id, name').eq('owner_id', ownerId).eq('id', farmId),
        supabase.from('feed_inventory').select('id, feed_name').eq('owner_id', ownerId).eq('farm_id', farmId),
        supabase.from('livestock').select('id, tag_number, name, species, sex').eq('owner_id', ownerId).eq('farm_id', farmId),
        supabase.from('poultry_batches').select('id, batch_name, bird_type').eq('owner_id', ownerId).eq('farm_id', farmId)
      ])
      if (requestId !== moduleLoadRequest.current) return
      if ([logsResult, farmResult, inventoryResult, livestockResult, poultryResult].some(result => result.error)) {
        setError([logsResult.error?.message, farmResult.error?.message, inventoryResult.error?.message, livestockResult.error?.message, poultryResult.error?.message].filter(Boolean).join(' '))
      }
      const farmNames = new Map((farmResult.data || []).map((item: Row) => [item.id, item.name]))
      const feedNames = new Map((inventoryResult.data || []).map((item: Row) => [item.id, item.feed_name]))
      const livestockNames = new Map((livestockResult.data || []).map((item: Row) => [item.id, item.tag_number || item.name || item.species]))
      const poultryNames = new Map((poultryResult.data || []).map((item: Row) => [item.id, item.batch_name || item.bird_type]))
      const logRows = (logsResult.data || []).map((log: Row) => ({
        ...log,
        farm_name: farmNames.get(log.farm_id) || '—',
        feed_name: feedNames.get(log.feed_inventory_id) || '—',
        target_name: livestockNames.get(log.livestock_id) || poultryNames.get(log.poultry_batch_id) || '—'
      }))
      setRows(logRows)
      setBusy(false)
      return
    }
    if (module === 'Customers' || module === 'Suppliers') {
      const partyTable = module === 'Customers' ? 'customers' : 'suppliers'
      const [partyResult, farmsResult] = await Promise.all([
        supabase.from(partyTable).select('*').eq('owner_id', ownerId).eq('farm_id', farmId).order('created_at', { ascending: false }).limit(100),
        supabase.from('farms').select('id, name').eq('owner_id', ownerId).eq('id', farmId)
      ])
      if (requestId !== moduleLoadRequest.current) return
      if (partyResult.error || farmsResult.error) {
        setError([partyResult.error?.message, farmsResult.error?.message].filter(Boolean).join(' '))
      }
      const farmNames = new Map((farmsResult.data || []).map((farmRow: Row) => [farmRow.id, farmRow.name]))
      const partyRows = (partyResult.data || []).map((party: Row) => ({ ...party, farm_name: farmNames.get(party.farm_id) || '—' }))
      setRows(partyRows)
      setBusy(false)
      return
    }
    const { data, error: queryError } = await supabase.from(table).select('*').eq('owner_id', ownerId).eq('farm_id', farmId).order('created_at', { ascending: false }).limit(100)
    if (requestId !== moduleLoadRequest.current) return
    if (queryError) setError(queryError.message)
    if (module === 'Sales' && data?.length) {
      const saleIds = data.map((sale: Row) => sale.id)
      const { data: itemRows, error: itemError } = await supabase.from('sale_items')
        .select('sale_id, item_type, description, quantity, unit, unit_price, line_total')
        .eq('owner_id', ownerId).in('sale_id', saleIds).order('id', { ascending: true })
      if (requestId !== moduleLoadRequest.current) return
      if (itemError) setError(`Sales were loaded, but their item details could not be loaded: ${itemError.message}`)
      const itemsBySale = new Map<string, Row[]>()
      for (const item of itemRows || []) {
        const current = itemsBySale.get(item.sale_id) || []
        current.push(item)
        itemsBySale.set(item.sale_id, current)
      }
      setRows(data.map((sale: Row) => ({
        ...sale,
        items_summary: (itemsBySale.get(sale.id) || []).map(item => `${item.description} (${item.quantity} ${item.unit})`).join(' · ') || 'No item details'
      })))
    } else {
      setRows(data || [])
    }
    setBusy(false)
  }

  async function submitAuth(e: FormEvent) {
    e.preventDefault(); setAuthBusy(true); setError('')
    try {
      const result = authMode === 'signup'
        ? await supabase.auth.signUp({ email: authEmail, password: authPassword, options: { data: { full_name: userName } } })
        : await supabase.auth.signInWithPassword({ email: authEmail, password: authPassword })
      if (result.error) throw result.error
      if (authMode === 'signup' && !result.data.session) setError('Account created. Check your email to confirm your address, then sign in.')
    } catch (e: any) { setError(e.message || 'Unable to authenticate') }
    finally { setAuthBusy(false) }
  }

  async function signOut() { await supabase.auth.signOut(); setSession(null); setFarms([]); setSelectedFarmId(''); setRows([]) }

  async function saveFarmProfile(values: FarmValues, editingFarmId?: string) {
    setError('')
    const areaAcres = values.area_acres.trim() === '' ? null : Number(values.area_acres)
    if (!values.name.trim()) throw new Error('Farm name is required.')
    if (areaAcres !== null && (!Number.isFinite(areaAcres) || areaAcres < 0)) {
      throw new Error('Farm size must be a valid non-negative number.')
    }
    const payload = {
      name: values.name.trim(),
      location: values.location.trim(),
      phone: values.phone.trim(),
      email: values.email.trim(),
      currency: values.currency,
      area_acres: areaAcres,
      notes: values.notes.trim()
    }
    const saveResult = editingFarmId
      ? await supabase.from('farms').update(payload).eq('id', editingFarmId).eq('owner_id', session.user.id).select('*').single()
      : await supabase.from('farms').insert({ ...payload, owner_id: session.user.id }).select('*').single()
    if (saveResult.error) throw saveResult.error

    const savedFarm = saveResult.data
    const { data, error: refreshError } = await supabase.from('farms').select('*').eq('owner_id', session.user.id).order('name', { ascending: true })
    if (refreshError) {
      setFarms(current => {
        const updated = current.filter(item => item.id !== savedFarm.id)
        updated.push(savedFarm)
        return updated.sort((a, b) => String(a.name).localeCompare(String(b.name)))
      })
      if (!editingFarmId) setSelectedFarmId(savedFarm.id)
      setSuccess(`Farm ${editingFarmId ? 'updated' : 'created'} successfully.`)
      setError(`Farm was saved, but the farm list could not be refreshed: ${refreshError.message}`)
      return
    }
    setFarms(data || [])
    if (!editingFarmId) setSelectedFarmId(savedFarm.id)
    setSuccess(`Farm ${editingFarmId ? 'updated' : 'created'} successfully.`)
  }

  const filteredRows = useMemo(() => rows.filter(row => JSON.stringify(row).toLowerCase().includes(search.toLowerCase())), [rows, search])

  if (!supabaseReady) return <SetupScreen />
  if (loadingAuth) return <div className="loading-screen"><div className="brand-mark"><Sprout /></div><p>Preparing your farm workspace…</p></div>
  if (!session) return <AuthScreen mode={authMode} setMode={setAuthMode} email={authEmail} setEmail={setAuthEmail} password={authPassword} setPassword={setAuthPassword} name={userName} setName={setUserName} onSubmit={submitAuth} busy={authBusy} error={error} />

  const greeting = new Date().getHours() < 12 ? 'Good morning' : new Date().getHours() < 17 ? 'Good afternoon' : 'Good evening'
  return <div className="app-shell">
    <aside className={`sidebar ${sidebarOpen ? 'sidebar-open' : ''}`}>
      <div className="brand"><div className="brand-mark"><Sprout size={23} /></div><div><strong>FarmPro</strong><span>MANAGEMENT</span></div><button className="icon-button close-menu" onClick={() => setSidebarOpen(false)}><X size={18}/></button></div>
      <div className="farm-switch"><div className="farm-avatar"><Leaf size={19}/></div><div className="farm-switch-copy"><strong>{farm?.name || 'My Farm'}</strong><span>{farm?.location || 'Farm workspace'}</span><select aria-label="Select farm" value={selectedFarmId} onChange={event => { moduleLoadRequest.current += 1; setRows([]); setBusy(Boolean(event.target.value)); setSelectedFarmId(event.target.value) }} disabled={!farms.length}><option value="">Select farm</option>{farms.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><button className="farm-manage-link" onClick={() => { setActive('Manage Farms'); setSidebarOpen(false) }}><Settings size={13}/> Manage Farms</button></div><ChevronDown size={16}/></div>
      {['OVERVIEW','LIVESTOCK','OPERATIONS','FINANCE'].map(group => <div className="nav-group" key={group}><div className="nav-label">{group}</div>{navigation.filter(n => n.group === group).map(item => { const Icon = item.icon; return <button key={item.label} className={`nav-item ${active === item.label ? 'active' : ''}`} onClick={() => {setActive(item.label); setSidebarOpen(false); setSearch('')}}><Icon size={18}/><span>{item.label}</span>{item.label === 'Tasks' && dashboardData.tasks.length > 0 && <em>{dashboardData.tasks.filter(task => !['completed','cancelled'].includes(String(task.status || '').toLowerCase())).length}</em>}</button> })}</div>)}
      <div className="sidebar-bottom"><div className="help-card"><div className="help-icon"><ShieldCheck size={18}/></div><strong>Your farm, in control</strong><p>Keep records organised and decisions data-driven.</p></div><button className="nav-item" onClick={() => setActive('Tasks')}><Settings size={18}/><span>Settings & preferences</span></button><div className="profile"><div className="profile-avatar">{userName.slice(0,1).toUpperCase()}</div><div className="profile-copy"><strong>{userName}</strong><span>Farm owner</span></div><button className="icon-button" title="Sign out" onClick={signOut}><LogOut size={17}/></button></div></div>
    </aside>
    {sidebarOpen && <div className="mobile-scrim" onClick={() => setSidebarOpen(false)} />}
    <main className="main-content">
      <header className="topbar"><div className="topbar-left"><button className="icon-button mobile-menu" onClick={() => setSidebarOpen(true)}><Menu size={21}/></button><div className="breadcrumbs">Workspace <span>/</span> <strong>{active}</strong></div></div><div className="topbar-right"><div className="date-chip"><CalendarDays size={15}/>{new Date().toLocaleDateString('en-UG',{weekday:'short',day:'numeric',month:'short',year:'numeric'})}</div><button className="icon-button notification" title="Notifications"><Bell size={19}/></button><div className="top-avatar">{userName.slice(0,1).toUpperCase()}</div></div></header>
      <div className="page-wrap">
        {error && <div className="alert"><Activity size={17}/><span>{error}</span><button onClick={() => setError('')}><X size={16}/></button></div>}
        {success && <div className="alert"><CheckCircle2 size={17}/><span>{success}</span><button onClick={() => setSuccess('')}><X size={16}/></button></div>}
        {active === 'Dashboard' ? <Dashboard greeting={greeting} userName={userName} farm={farm} data={dashboardData} period={period} setPeriod={setPeriod} customStart={customStart} customEnd={customEnd} setCustomStart={setCustomStart} setCustomEnd={setCustomEnd} onNavigate={setActive} onQuickAdd={(module: ModuleKey) => { setActive(module); setModal(true) }} onAdd={() => { setActive('Livestock'); setModal(true) }} /> :
          active === 'Manage Farms' ? <FarmManagement farms={farms} selectedFarmId={selectedFarmId} loading={farmsLoading} onSelectFarm={farmId => { moduleLoadRequest.current += 1; setRows([]); setBusy(Boolean(farmId)); setSelectedFarmId(farmId) }} onSaveFarm={saveFarmProfile} /> :
            <ModulePage module={active} rows={filteredRows} loading={busy} search={search} setSearch={setSearch} onAdd={() => { setEditingRecord(null); setModal(true) }} onEdit={active === 'Livestock' ? (record: Row) => { setEditingRecord(record); setModal(true) } : undefined} />}
      </div>
    </main>
    {modal && <RecordModal key={`${active}:${farm?.id || ''}:${editingRecord?.id || 'new'}`} module={active} farmId={farm?.id} userId={session.user.id} editingRecord={editingRecord} onClose={() => { setModal(false); setEditingRecord(null) }} onSaved={async () => {
      setModal(false)
      setEditingRecord(null)
      const successLabels: Partial<Record<ModuleKey, string>> = {
        Livestock: 'Livestock record', Poultry: 'Poultry batch', 'Health & Breeding': 'Health record',
        'Breeding Records': 'Breeding record', 'Feed & Inventory': 'Feed inventory item', 'Feed Logs': 'Feed log',
        Production: 'Production record', Sales: 'Sale and sale items', Purchases: 'Purchase', Expenses: 'Expense',
        Customers: 'Customer', Suppliers: 'Supplier', Tasks: 'Farm task'
      }
      const successLabel = successLabels[active as ModuleKey] || 'Record'
      setSuccess(`${successLabel} ${editingRecord ? 'updated' : 'saved'} successfully.`)
      const { data: updatedFarms, error: farmError } = await supabase.from('farms').select('*').eq('owner_id', session.user.id).order('name', { ascending: true })
      if (farmError) setError(`Unable to refresh farms: ${farmError.message}`)
      else {
        const availableFarms = updatedFarms || []
        setFarms(availableFarms)
        setSelectedFarmId(current => availableFarms.some(item => item.id === current) ? current : availableFarms[0]?.id || '')
      }
      if (active !== 'Dashboard' && active !== 'Manage Farms') await loadModule(active)
    }} />}
  </div>
}

function Dashboard({ greeting, userName, farm, data, period, setPeriod, customStart, customEnd, setCustomStart, setCustomEnd, onNavigate, onQuickAdd, onAdd }: {
  greeting: string
  userName: string
  farm: Row | null
  data: DashboardData
  period: ReportingPeriod
  setPeriod: (period: ReportingPeriod) => void
  customStart: string
  customEnd: string
  setCustomStart: (value: string) => void
  setCustomEnd: (value: string) => void
  onNavigate: (module: ModuleKey) => void
  onQuickAdd: (module: ModuleKey) => void
  onAdd: () => void
}) {
  const range = periodRange(period, customStart, customEnd)
  const prior = previousRange(range)
  const currencyCode = farm?.currency
  const formatMoney = (amount: number) => {
    if (!currencyCode) return 'Currency not set'
    try {
      return new Intl.NumberFormat('en', { style: 'currency', currency: currencyCode, maximumFractionDigits: 0 }).format(amount)
    } catch {
      return `${currencyCode} ${amount.toLocaleString()}`
    }
  }
  const inRange = (value: unknown, window: DateRange) => {
    if (!value) return false
    const date = String(value).slice(0, 10)
    return date >= localDateString(window.start) && date < localDateString(window.end)
  }
  const activeSales = data.sales.filter((sale: Row) => inRange(sale.sale_date, range) && String(sale.status || '').toLowerCase() !== 'cancelled')
  const recentPeriodSales = activeSales.slice().sort((a: Row, b: Row) => String(b.sale_date || '').localeCompare(String(a.sale_date || ''))).slice(0, 6)
  const priorSales = data.sales.filter((sale: Row) => inRange(sale.sale_date, prior) && String(sale.status || '').toLowerCase() !== 'cancelled')
  const activeExpenses = data.expenses.filter((expense: Row) => inRange(expense.expense_date, range))
  const priorExpenses = data.expenses.filter((expense: Row) => inRange(expense.expense_date, prior))
  const activeSalesTotal = sumAmount(activeSales, 'total_amount')
  const priorSalesTotal = sumAmount(priorSales, 'total_amount')
  const activeExpensesTotal = sumAmount(activeExpenses, 'amount')
  const priorExpensesTotal = sumAmount(priorExpenses, 'amount')
  const profit = activeSalesTotal - activeExpensesTotal
  const priorProfit = priorSalesTotal - priorExpensesTotal
  const isFailed = (table: string) => data.failedTables.includes(table)
  const percentageChange = (current: number, previous: number) => previous > 0 ? `${current >= previous ? '+' : ''}${((current - previous) / previous * 100).toFixed(1)}% vs prior period` : 'No prior-period baseline'
  const livestockActive = data.livestock.filter((animal: Row) => String(animal.status || '').toLowerCase() === 'active')
  const poultryActive = data.poultry.filter((batch: Row) => String(batch.status || '').toLowerCase() === 'active')
  const speciesCounts = Object.entries(livestockActive.reduce((counts: Record<string, number>, animal: Row) => {
    const species = String(animal.species || 'Unspecified')
    counts[species] = (counts[species] || 0) + 1
    return counts
  }, {}))
  const activePoultryCount = poultryActive.reduce((sum: number, batch: Row) => sum + (Number(batch.current_count) || 0), 0)
  const lowStock = data.feedInventory.filter((item: Row) => item.quantity != null && item.quantity !== '' && item.reorder_level != null && item.reorder_level !== '' && Number.isFinite(Number(item.quantity)) && Number.isFinite(Number(item.reorder_level)) && Number(item.quantity) <= Number(item.reorder_level))
  const todayKey = localDateString(new Date())
  const upcomingKey = localDateString(new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate() + 7))
  const actionableTasks = data.tasks.filter((task: Row) => ['pending', 'in_progress'].includes(String(task.status || '').toLowerCase()))
  const overdueTasks = actionableTasks.filter((task: Row) => task.due_date && String(task.due_date).slice(0, 10) < todayKey)
  const upcomingTasks = actionableTasks.filter((task: Row) => task.due_date && String(task.due_date).slice(0, 10) >= todayKey && String(task.due_date).slice(0, 10) <= upcomingKey)
  const healthAlerts = data.health.filter((record: Row) => record.next_due_date && String(record.next_due_date).slice(0, 10) <= upcomingKey)
    .sort((a: Row, b: Row) => String(a.next_due_date).localeCompare(String(b.next_due_date))).slice(0, 4)
  const customerNames = new Map(data.customers.map(customer => [customer.id, customer.name]))
  const paymentRows = [...data.outstandingSales, ...data.recentSales]
  const paymentFieldsAvailable = paymentRows.every((sale: Row) => Object.prototype.hasOwnProperty.call(sale, 'total_amount') && Object.prototype.hasOwnProperty.call(sale, 'amount_paid') && sale.total_amount != null && Number.isFinite(Number(sale.total_amount)))
  const outstandingAmount = paymentFieldsAvailable ? data.outstandingSales.reduce((sum: number, sale: Row) => sum + Math.max(0, (Number(sale.total_amount) || 0) - (Number(sale.amount_paid) || 0)), 0) : null
  const feedUsageLogs = data.feedUsageLogs.slice().sort((a: Row, b: Row) =>
    String(b.feed_on || b.fed_on || '').localeCompare(String(a.feed_on || a.fed_on || ''))
  )
  const estimatedFeedCostAvailable = feedUsageLogs.every((log: Row) => log.cost != null && log.cost !== '' && Number.isFinite(Number(log.cost)))
  const estimatedFeedCost = estimatedFeedCostAvailable ? sumAmount(feedUsageLogs, 'cost') : null
  const productionGroups = Object.values(data.production.reduce((groups: Record<string, { type: string; unit: string; quantity: number; records: number }>, record: Row) => {
    const type = String(record.production_type || 'Other')
    const unit = String(record.unit || 'unit not recorded')
    const key = `${type}::${unit}`
    groups[key] = groups[key] || { type, unit, quantity: 0, records: 0 }
    groups[key].quantity += Number(record.quantity) || 0
    groups[key].records += 1
    return groups
  }, {}))
  const chart = useMemo(() => {
    const days = Math.max(1, Math.ceil((range.end.getTime() - range.start.getTime()) / 86400000))
    const bucketCount = days <= 10 ? Math.min(days, 7) : days <= 45 ? 5 : Math.min(12, Math.max(3, Math.ceil(days / 30)))
    const buckets = Array.from({ length: bucketCount }, (_, index) => {
      const start = new Date(range.start.getTime() + (range.end.getTime() - range.start.getTime()) * index / bucketCount)
      const end = new Date(range.start.getTime() + (range.end.getTime() - range.start.getTime()) * (index + 1) / bucketCount)
      return { start, end, sales: 0, expenses: 0, profit: 0 }
    })
    const bucketFor = (value: unknown) => {
      if (!value) return -1
      const timestamp = new Date(`${String(value).slice(0, 10)}T00:00:00`).getTime()
      return buckets.findIndex(bucket => timestamp >= bucket.start.getTime() && timestamp < bucket.end.getTime())
    }
    data.sales.filter((sale: Row) => String(sale.status || '').toLowerCase() !== 'cancelled').forEach((sale: Row) => {
      const index = bucketFor(sale.sale_date)
      if (index >= 0) buckets[index].sales += Number(sale.total_amount) || 0
    })
    data.expenses.forEach((expense: Row) => {
      const index = bucketFor(expense.expense_date)
      if (index >= 0) buckets[index].expenses += Number(expense.amount) || 0
    })
    buckets.forEach(bucket => { bucket.profit = bucket.sales - bucket.expenses })
    return buckets
  }, [data.sales, data.expenses, range.start.getTime(), range.end.getTime()])
  const chartMaximum = Math.max(0, ...chart.flatMap(bucket => [bucket.sales, bucket.expenses, bucket.profit]))
  const chartMinimum = Math.min(0, ...chart.map(bucket => bucket.profit))
  const chartSpan = Math.max(1, chartMaximum - chartMinimum)
  const chartY = (value: number) => 33 + (chartMaximum - value) / chartSpan * 172
  const chartPoints = (field: 'sales' | 'expenses' | 'profit') => chart.map((bucket, index) => {
    const x = chart.length === 1 ? 360 : 36 + index * 648 / (chart.length - 1)
    return `${x},${chartY(bucket[field])}`
  }).join(' ')
  const productionTrends = productionGroups.slice(0, 4).map(group => {
    const values = chart.map(bucket => data.production.reduce((sum: number, record: Row) => {
      if (String(record.production_type || 'Other') !== group.type || String(record.unit || 'unit not recorded') !== group.unit || !record.recorded_on) return sum
      const timestamp = new Date(`${String(record.recorded_on).slice(0, 10)}T00:00:00`).getTime()
      return timestamp >= bucket.start.getTime() && timestamp < bucket.end.getTime() ? sum + (Number(record.quantity) || 0) : sum
    }, 0))
    const maximum = Math.max(1, ...values)
    const points = values.map((value, index) => `${values.length === 1 ? 60 : 3 + index * 114 / (values.length - 1)},${25 - value / maximum * 21}`).join(' ')
    return { ...group, points }
  })
  const formatActivity = (dateValue: unknown) => dateValue ? dateLabel(String(dateValue)) : 'Date not recorded'
  const activities = [
    ...data.recentSales.filter((sale: Row) => String(sale.status || '').toLowerCase() !== 'cancelled').map((sale: Row) => ({ title: `Sale recorded${sale.reference_no ? ` · ${sale.reference_no}` : ''}`, date: sale.sale_date, icon: ShoppingCart })),
    ...data.expenses.map((expense: Row) => ({ title: `Expense recorded${expense.category ? ` · ${expense.category}` : ''}`, date: expense.expense_date, icon: CircleDollarSign })),
    ...data.production.map((record: Row) => ({ title: `${record.production_type || 'Production'} recorded${record.quantity != null ? ` · ${record.quantity} ${record.unit || ''}` : ''}`.trim(), date: record.recorded_on, icon: Sprout })),
    ...data.feedLogs.map((log: Row) => ({ title: `Feed usage recorded${log.quantity != null ? ` · ${log.quantity} ${log.unit || ''}` : ''}`.trim(), date: log.feed_on || log.fed_on, icon: Wheat })),
    ...data.tasks.map((task: Row) => ({ title: `Task created${task.title ? ` · ${task.title}` : ''}`, date: task.created_at, icon: ClipboardList }))
  ].sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))).slice(0, 5)
  const periodOptions: { value: ReportingPeriod; label: string }[] = [
    { value: 'week', label: 'This week' }, { value: 'month', label: 'This month' },
    { value: 'last-month', label: 'Last month' }, { value: 'quarter', label: 'Last 3 months' },
    { value: 'year', label: 'This year' }, { value: 'custom', label: 'Custom range' }
  ]

  return <div className="dashboard dashboard-redesign">
    <section className="dashboard-heading">
      <div>
        <div className="eyebrow"><span className="live-dot" /> FARM COMMAND CENTRE</div>
        <h1>{greeting}, {userName.split(' ')[0]}</h1>
        <p>{farm ? `${farm.name}${farm.location ? ` · ${farm.location}` : ''}` : 'Create a farm profile to begin managing your records.'}</p>
      </div>
      <div className="dashboard-heading-actions">
        <label className="dashboard-period"><CalendarDays size={16} /><span className="sr-only">Reporting period</span>
          <select value={period} onChange={event => setPeriod(event.target.value as ReportingPeriod)} aria-label="Reporting period">
            {periodOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select><ChevronDown size={14} />
        </label>
        <button className="primary-button" onClick={onAdd}><Plus size={18} /> Add record</button>
      </div>
    </section>
    {period === 'custom' && <div className="custom-range"><label>From <input type="date" value={customStart} max={customEnd} onChange={event => setCustomStart(event.target.value)} /></label><label>To <input type="date" value={customEnd} min={customStart} max={todayKey} onChange={event => setCustomEnd(event.target.value)} /></label></div>}
    <section className="dashboard-context">
      <div className="context-farm"><span className="context-farm-icon"><Leaf size={19} /></span><div><small>SELECTED FARM</small><strong>{farm?.name || 'No farm selected'}</strong><span>{farm?.location || 'Farm workspace'}</span></div></div>
      <div className="context-date"><CalendarDays size={16} /><span>{new Date().toLocaleDateString('en-UG', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</span></div>
      <div className="context-report"><span>REPORTING PERIOD</span><strong>{dateRangeLabel(range)}</strong></div>
    </section>
    {data.loading && <div className="dashboard-loading" role="status"><span className="loading-spinner" /> Updating farm data…</div>}
    {!farm ? <div className="dashboard-empty"><Sprout size={25} /><h2>Choose your farm workspace</h2><p>Create a farm profile or select an available farm to view its live dashboard.</p></div> : <>
      <section className="section-heading dashboard-section-heading"><div><h2>Financial overview</h2><p>Recorded results for {dateRangeLabel(range)}</p></div><span className="estimate-label"><ShieldCheck size={14} /> Operating estimate</span></section>
      <section className="stats-grid financial-grid">
        {[
          { label: 'Total sales', value: isFailed('sales') ? 'Unavailable' : formatMoney(activeSalesTotal), hint: percentageChange(activeSalesTotal, priorSalesTotal), detail: 'Recorded sales, excluding cancelled', icon: TrendingUp, tone: 'green' },
          { label: 'Operating expenses', value: isFailed('expenses') ? 'Unavailable' : formatMoney(activeExpensesTotal), hint: percentageChange(activeExpensesTotal, priorExpensesTotal), detail: 'Recorded farm expenses only', icon: CircleDollarSign, tone: 'rose' },
          { label: 'Estimated operating profit', value: isFailed('sales') || isFailed('expenses') ? 'Unavailable' : formatMoney(profit), hint: percentageChange(profit, priorProfit), detail: 'Sales less recorded expenses', icon: Activity, tone: 'blue' },
          { label: 'Outstanding customer payments', value: isFailed('outstanding payments') || isFailed('recent sales') || outstandingAmount === null ? 'Unavailable' : formatMoney(outstandingAmount), hint: outstandingAmount === null ? 'Payment fields not present in returned records' : outstandingAmount === 0 ? 'No unpaid balance recorded' : 'Across unpaid and partially paid sales', detail: 'Outstanding balance from actual sale records', icon: Clock3, tone: 'amber' }
        ].map(card => {
          const Icon = card.icon
          return <article className="stat-card premium-stat" key={card.label}>
            <div className="stat-top"><span>{card.label}</span><div className={`stat-icon ${card.tone}`}><Icon size={19} /></div></div>
            <strong className={`stat-value ${card.value === 'Unavailable' ? 'stat-unavailable' : ''}`}>{card.value}</strong>
            <span className="stat-hint">{card.hint}</span><small>{card.detail}</small>
          </article>
        })}
      </section>
      <section className="dashboard-main-grid">
        <article className="panel chart-panel">
          <div className="panel-header"><div><h3>Financial performance</h3><p>Sales, expenses and estimated operating profit</p></div><span className="chart-range-label">{period === 'custom' ? 'Custom range' : periodOptions.find(option => option.value === period)?.label}</span></div>
          {isFailed('sales') || isFailed('expenses') ? <div className="panel-empty"><CircleAlert size={20} /><span>Financial chart data could not be loaded.</span></div> : <div className="chart-scroll">
            <div className="chart-legend"><span><i className="legend-sales" /> Sales</span><span><i className="legend-expenses" /> Expenses</span><span><i className="legend-profit" /> Operating profit</span></div>
            <svg className="performance-chart" viewBox="0 0 720 250" role="img" aria-label="Financial performance chart for the selected reporting period">
              {[0, 1, 2, 3].map(line => {
                const value = chartMaximum - chartSpan * line / 3
                const y = 33 + line * 57
                return <g key={line}><line x1="36" x2="684" y1={y} y2={y} className="chart-grid-line" /><text x="28" y={y + 4} textAnchor="end" className="chart-axis-label">{Math.round(value).toLocaleString()}</text></g>
              })}
              <polyline points={chartPoints('sales')} className="chart-line line-sales" />
              <polyline points={chartPoints('expenses')} className="chart-line line-expenses" />
              <polyline points={chartPoints('profit')} className="chart-line line-profit" />
              {chart.map((bucket, index) => {
                const x = chart.length === 1 ? 360 : 36 + index * 648 / (chart.length - 1)
                const label = bucket.start.toLocaleDateString('en', { day: 'numeric', month: 'short' })
                return <g key={`${bucket.start.toISOString()}-${index}`}><circle cx={x} cy={chartY(bucket.sales)} r="3.5" className="chart-point point-sales"><title>Sales: {formatMoney(bucket.sales)}</title></circle><circle cx={x} cy={chartY(bucket.expenses)} r="3.5" className="chart-point point-expenses"><title>Expenses: {formatMoney(bucket.expenses)}</title></circle><circle cx={x} cy={chartY(bucket.profit)} r="3.5" className="chart-point point-profit"><title>Operating profit: {formatMoney(bucket.profit)}</title></circle><text x={x} y="236" textAnchor="middle" className="chart-axis-label">{label}</text></g>
              })}
            </svg>
          </div>}
        </article>
        <article className="panel quick-panel">
          <div className="panel-header"><div><h3>Quick actions</h3><p>Open an existing record form</p></div></div>
          <div className="quick-actions redesign-quick-actions">
            {[
              { label: 'Add livestock', module: 'Livestock' as ModuleKey, icon: Beef, tone: 'green' },
              { label: 'Add poultry batch', module: 'Poultry' as ModuleKey, icon: Egg, tone: 'amber' },
              { label: 'Record production', module: 'Production' as ModuleKey, icon: Sprout, tone: 'green' },
              { label: 'Record sale', module: 'Sales' as ModuleKey, icon: ShoppingCart, tone: 'blue' },
              { label: 'Record expense', module: 'Expenses' as ModuleKey, icon: CircleDollarSign, tone: 'rose' },
              { label: 'Record feed usage', module: 'Feed Logs' as ModuleKey, icon: Wheat, tone: 'amber' },
              { label: 'Create task', module: 'Tasks' as ModuleKey, icon: ClipboardList, tone: 'blue' }
            ].map(action => {
              const Icon = action.icon
              return <button key={action.module} onClick={() => onQuickAdd(action.module)}><span className={`quick-icon ${action.tone}`}><Icon size={17} /></span><strong>{action.label}</strong><Plus size={15} /></button>
            })}
          </div>
        </article>
      </section>
      <section className="dashboard-support-grid">
        <article className="panel overview-panel">
          <div className="panel-header"><div><h3>Livestock & poultry</h3><p>Active animals and flock counts only</p></div><button className="text-button" onClick={() => onNavigate('Livestock')}>Manage <ArrowUpRight size={14} /></button></div>
          {isFailed('livestock') || isFailed('poultry batches') ? <div className="panel-empty">Livestock data unavailable.</div> : <div className="livestock-overview">
            <div className="live-counts"><div><span className="quick-icon green"><Beef size={18} /></span><div><strong>{livestockActive.length.toLocaleString()}</strong><small>Active livestock</small></div></div><div><span className="quick-icon amber"><Egg size={18} /></span><div><strong>{activePoultryCount.toLocaleString()}</strong><small>Active poultry birds · {poultryActive.length} batches</small></div></div></div>
            <div className="species-list">{speciesCounts.length ? speciesCounts.map(([species, count]) => <div key={species}><span>{species}</span><strong>{count}</strong></div>) : <p>No active livestock recorded.</p>}</div>
            <div className="health-alert-list"><h4><HeartPulse size={15} /> Health reminders</h4>{healthAlerts.length ? healthAlerts.map((record: Row) => {
              const overdue = String(record.next_due_date).slice(0, 10) < todayKey
              return <div className={overdue ? 'health-reminder overdue' : 'health-reminder'} key={record.id}><CircleAlert size={15} /><span>{record.condition_or_vaccine || record.record_type || 'Health follow-up'}</span><strong>{overdue ? 'Overdue' : dateLabel(record.next_due_date)}</strong></div>
            }) : <p>{isFailed('health records') ? 'Health reminders unavailable.' : 'No health follow-ups due in the next 7 days.'}</p>}</div>
          </div>}
        </article>
        <article className="panel production-panel">
          <div className="panel-header"><div><h3>Production performance</h3><p>Quantities stay grouped by type and unit</p></div><button className="text-button" onClick={() => onNavigate('Production')}>View records <ArrowUpRight size={14} /></button></div>
          {isFailed('production records') ? <div className="panel-empty">Production data unavailable.</div> : productionGroups.length ? <div className="production-groups">{productionGroups.map(group => <div key={`${group.type}-${group.unit}`}><span className="production-type"><Milk size={16} />{group.type}</span><strong>{group.quantity.toLocaleString()} <small>{group.unit}</small></strong><span>{group.records} record{group.records === 1 ? '' : 's'}</span></div>)}</div> : <div className="panel-empty">No production recorded for this period.</div>}
          <div className="production-trends"><h4>Production trends</h4>{productionTrends.length ? productionTrends.map(group => <div key={`${group.type}-${group.unit}`}><span>{group.type} · {group.unit}</span><svg viewBox="0 0 120 28" role="img" aria-label={`${group.type} production trend in ${group.unit}`}><polyline points={group.points} /></svg><strong>{group.quantity.toLocaleString()}</strong></div>) : <p>No production trend available for this period.</p>}</div>
          <div className="recent-production"><h4>Recent production</h4>{data.production.slice().sort((a: Row, b: Row) => String(b.recorded_on || '').localeCompare(String(a.recorded_on || ''))).slice(0, 3).map((record: Row) => <div key={record.id}><span>{record.production_type || 'Production'} · {formatActivity(record.recorded_on)}</span><strong>{record.quantity ?? '—'} {record.unit || ''}</strong></div>)}</div>
        </article>
        <article className="panel inventory-panel">
          <div className="panel-header"><div><h3>Feed & inventory</h3><p>Stock levels and recent feed usage</p></div><button className="text-button" onClick={() => onNavigate('Feed & Inventory')}>Inventory <ArrowUpRight size={14} /></button></div>
          {isFailed('feed inventory') ? <div className="panel-empty">Feed inventory data unavailable.</div> : <>
            <div className="inventory-metrics"><div><strong>{data.feedInventory.length}</strong><span>Feed items</span></div><div className={lowStock.length ? 'low-stock-count' : ''}><strong>{lowStock.length}</strong><span>Below reorder level</span></div><div><strong>{isFailed('feed usage') ? '—' : formatMoney(estimatedFeedCost ?? 0)}</strong><span>Selected-period usage cost</span></div></div>
            {lowStock.length > 0 && <div className="low-stock-list"><h4><CircleAlert size={15} /> Reorder needed</h4>{lowStock.slice(0, 4).map((item: Row) => <div key={item.id}><span>{item.feed_name || item.feed_type || 'Feed item'}</span><strong>{item.quantity} {item.unit || ''} <small> / reorder {item.reorder_level}</small></strong></div>)}</div>}
            <div className="feed-consumption"><h4>Recent feed consumption</h4>{isFailed('feed usage') ? <p>Feed consumption could not be loaded.</p> : feedUsageLogs.slice(0, 3).map((log: Row) => <div key={log.id}><span>{formatActivity(log.feed_on || log.fed_on)}</span><strong>{log.quantity ?? '—'} {log.unit || ''}</strong></div>)}{!isFailed('feed usage') && !feedUsageLogs.length && <p>No feed consumption recorded during this period.</p>}</div>
          </>}
        </article>
        <article className="panel operations-panel">
          <div className="panel-header"><div><h3>Operational overview</h3><p>Tasks and recent farm activity</p></div><button className="text-button" onClick={() => onNavigate('Tasks')}>All tasks <ArrowUpRight size={14} /></button></div>
          {isFailed('tasks') ? <div className="panel-empty">Task information unavailable.</div> : <div className="task-summary"><div className={overdueTasks.length ? 'task-alert-value' : ''}><strong>{actionableTasks.length}</strong><span>Pending</span></div><div className={overdueTasks.length ? 'task-alert-value' : ''}><strong>{overdueTasks.length}</strong><span>Overdue</span></div><div><strong>{upcomingTasks.length}</strong><span>Due this week</span></div></div>}
          <div className="activity-list"><h4>Recent farm activity</h4>{activities.length ? activities.map((item, index) => {
            const Icon = item.icon
            return <div key={`${item.title}-${index}`}><span className="activity-icon"><Icon size={15} /></span><span>{item.title}<small>{formatActivity(item.date)}</small></span></div>
          }) : <p>No recent activity recorded.</p>}</div>
        </article>
      </section>
      <section className="panel recent-panel dashboard-sales">
        <div className="panel-header"><div><h3>Recent sales</h3><p>{farm.name} · {dateRangeLabel(range)}</p></div><button className="text-button" onClick={() => onNavigate('Sales')}>View sales <ArrowUpRight size={15} /></button></div>
        {isFailed('sales') ? <div className="panel-empty">Recent sales could not be loaded.</div> : recentPeriodSales.length ? <div className="table-wrap"><table><thead><tr><th>Reference</th><th>Date</th><th>Customer</th><th>Amount</th><th>Payment status</th></tr></thead><tbody>{recentPeriodSales.map((sale: Row) => {
          const status = String(sale.status || '').toLowerCase()
          const label = status === 'completed' || status === 'paid' ? 'Paid' : status === 'part_paid' || status === 'partially_paid' ? 'Partially Paid' : status === 'unpaid' ? 'Unpaid' : 'Unavailable'
          return <tr key={sale.id}><td><strong>{sale.reference_no || `SALE-${String(sale.id).slice(0, 6).toUpperCase()}`}</strong></td><td>{dateLabel(sale.sale_date)}</td><td>{sale.customer_id ? customerNames.get(sale.customer_id) || 'Customer unavailable' : '—'}</td><td className="amount">{formatMoney(Number(sale.total_amount) || 0)}</td><td><span className={`status-badge ${label === 'Paid' ? 'success' : label === 'Unavailable' ? '' : 'pending'}`}>{label}</span></td></tr>
        })}</tbody></table></div> : <div className="panel-empty">No sales recorded during this period.</div>}
      </section>
    </>}
    <footer className="footer"><span>© {new Date().getFullYear()} FarmPro Management</span><span><ShieldCheck size={14} /> Your farm data is protected by access policies</span></footer>
  </div>
}

function FarmManagement({ farms, selectedFarmId, loading, onSelectFarm, onSaveFarm }: {
  farms: Row[]
  selectedFarmId: string
  loading: boolean
  onSelectFarm: (farmId: string) => void
  onSaveFarm: (values: FarmValues, editingFarmId?: string) => Promise<void>
}) {
  const [formOpen, setFormOpen] = useState(false)
  const [editingFarm, setEditingFarm] = useState<Row | null>(null)
  const [values, setValues] = useState<FarmValues>({ name: '', location: '', phone: '', email: '', currency: 'UGX', area_acres: '', notes: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function openAddForm() {
    setEditingFarm(null)
    setValues({ name: '', location: '', phone: '', email: '', currency: 'UGX', area_acres: '', notes: '' })
    setError('')
    setFormOpen(true)
  }

  function openEditForm(farmRow: Row) {
    setEditingFarm(farmRow)
    setValues({
      name: farmRow.name || '',
      location: farmRow.location || '',
      phone: farmRow.phone || '',
      email: farmRow.email || '',
      currency: farmRow.currency || 'UGX',
      area_acres: farmRow.area_acres == null ? '' : String(farmRow.area_acres),
      notes: farmRow.notes || ''
    })
    setError('')
    setFormOpen(true)
  }

  async function submitFarm(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (!values.name.trim()) {
      setError('Farm name is required.')
      return
    }
    if (values.area_acres.trim() !== '' && (!Number.isFinite(Number(values.area_acres)) || Number(values.area_acres) < 0)) {
      setError('Farm size must be a valid non-negative number.')
      return
    }
    setSaving(true)
    try {
      await onSaveFarm(values, editingFarm?.id)
      setFormOpen(false)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError))
    } finally {
      setSaving(false)
    }
  }

  return <div className="farm-management">
    <div className="farm-management-heading">
      <div>
        <span className="eyebrow"><Sprout size={14}/> YOUR WORKSPACE</span>
        <h1>Farm Management</h1>
        <p>View your farms, update their details, or choose which farm to work in.</p>
      </div>
      <button className="primary-button" onClick={openAddForm}><Plus size={16}/> Add Farm</button>
    </div>

    {loading ? <div className="farm-management-loading"><span className="loading-spinner"/> Loading your farms…</div> :
      farms.length ? <div className="farm-card-grid">{farms.map(farmRow => {
        const isActive = farmRow.id === selectedFarmId
        const contact = [farmRow.phone, farmRow.email].filter(Boolean)
        return <article className={`farm-card ${isActive ? 'farm-card-active' : ''}`} key={farmRow.id}>
          <div className="farm-card-top">
            <span className="farm-card-icon"><Sprout size={19}/></span>
            {isActive && <span className="farm-active-badge"><CheckCircle2 size={13}/> Active farm</span>}
          </div>
          <h2>{farmRow.name || 'Unnamed farm'}</h2>
          <div className="farm-card-details">
            <span><MapPin size={15}/>{farmRow.location || 'Location not added'}</span>
            {contact.length > 0 && <span>{farmRow.phone ? <Phone size={15}/> : <Mail size={15}/>}<span>{contact.join(' · ')}</span></span>}
            <span><CircleDollarSign size={15}/>{farmRow.currency || 'Currency not set'}</span>
            {farmRow.area_acres != null && <span><Ruler size={15}/>{Number(farmRow.area_acres).toLocaleString()} acres</span>}
          </div>
          {farmRow.notes && <p className="farm-card-notes">{farmRow.notes}</p>}
          <div className="farm-card-actions">
            <button className="secondary-button" onClick={() => openEditForm(farmRow)}><Pencil size={14}/> Edit Farm</button>
            {!isActive && <button className="farm-select-button" onClick={() => onSelectFarm(farmRow.id)}>Switch Farm</button>}
          </div>
        </article>
      })}</div> : <div className="farm-management-empty">
        <span className="farm-empty-icon"><Sprout size={23}/></span>
        <h2>No farms yet</h2>
        <p>Add a farm to start organising your livestock, operations, and records.</p>
        <button className="primary-button" onClick={openAddForm}><Plus size={16}/> Add your first farm</button>
      </div>}

    {formOpen && <div className="modal-backdrop" onClick={() => !saving && setFormOpen(false)}>
      <div className="modal farm-form-modal" role="dialog" aria-modal="true" aria-labelledby="farm-form-title" onClick={e => e.stopPropagation()}>
        <div className="modal-head"><div><span className="eyebrow">FARM PROFILE</span><h2 id="farm-form-title">{editingFarm ? 'Edit farm' : 'Add a farm'}</h2></div><button type="button" className="icon-button" onClick={() => setFormOpen(false)} disabled={saving} aria-label="Close"><X size={19}/></button></div>
        <form onSubmit={submitFarm}>
          <div className="farm-form-grid">
            <label className="field farm-form-wide"><span>Farm name *</span><input required maxLength={120} value={values.name} onChange={e => setValues({ ...values, name: e.target.value })} placeholder="e.g. Green Valley Farm"/></label>
            <label className="field"><span>Location</span><input maxLength={200} value={values.location} onChange={e => setValues({ ...values, location: e.target.value })} placeholder="District / village"/></label>
            <label className="field"><span>Phone</span><input type="tel" maxLength={50} value={values.phone} onChange={e => setValues({ ...values, phone: e.target.value })} placeholder="Contact number"/></label>
            <label className="field"><span>Email</span><input type="email" maxLength={254} value={values.email} onChange={e => setValues({ ...values, email: e.target.value })} placeholder="Farm email (optional)"/></label>
            <label className="field"><span>Currency</span><select required value={values.currency} onChange={e => setValues({ ...values, currency: e.target.value })}><option value="UGX">UGX — Ugandan Shilling</option><option value="USD">USD — US Dollar</option><option value="KES">KES — Kenyan Shilling</option><option value="TZS">TZS — Tanzanian Shilling</option></select></label>
            <label className="field"><span>Farm size (acres)</span><input type="number" min="0" step="any" value={values.area_acres} onChange={e => setValues({ ...values, area_acres: e.target.value })} placeholder="e.g. 12.5"/></label>
            <label className="field farm-form-wide"><span>Notes</span><textarea rows={3} maxLength={2000} value={values.notes} onChange={e => setValues({ ...values, notes: e.target.value })} placeholder="Additional details about this farm"/></label>
          </div>
          {error && <div className="form-error">{error}</div>}
          <div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setFormOpen(false)} disabled={saving}>Cancel</button><button className="primary-button" disabled={saving}>{saving ? 'Saving…' : editingFarm ? 'Save changes' : 'Create farm'}</button></div>
        </form>
      </div>
    </div>}
  </div>
}

function ModulePage({ module, rows, loading, search, setSearch, onAdd, onEdit }: any) {
  const headings: Record<string,string[]> = {
    Livestock: ['species','tag_number','name','breed','sex','date_of_birth','acquired_on','acquisition_type','purchase_cost','weight_kg','status','maternal_lineage','parent_lineage'],
    Poultry: ['batch_name','bird_type','breed','start_date','current_count','status'],
    'Health & Breeding': ['record_type','condition_or_vaccine','record_date','next_due_date','cost','administered_by'],
    'Breeding Records': ['species','mating_date','expected_date','outcome','offspring_count','linked_name'],
    'Feed & Inventory': ['feed_name','feed_type','quantity','unit','reorder_level','unit_cost'],
    'Feed Logs': ['fed_on','feed_name','target_name','quantity','unit','cost','notes'],
    Production: ['production_type','recorded_on','quantity','unit','quality_grade'],
    Sales: ['reference_no','sale_date','items_summary','subtotal','discount','total_amount','amount_paid','status','payment_method'],
    Purchases: ['purchase_date','category','description','total_amount','amount_paid','payment_status'],
    Expenses: ['expense_date','category','description','amount','payee','payment_method'],
    Customers: ['name','phone','email','address','farm_name'],
    Suppliers: ['name','phone','email','address','farm_name'],
    Tasks: ['title','category','due_date','priority','status','assigned_to']
  }
  const cols = headings[module] || Object.keys(rows[0] || {}).filter(k => !['id','owner_id','farm_id','created_at','updated_at','notes'].includes(k)).slice(0,6)
  const label = (key: string) => key.replace(/_/g,' ').replace(/\b\w/g, (c: string) => c.toUpperCase())
  return <div className="module-page"><div className="welcome-row"><div><div className="eyebrow"><span className="live-dot"/> FARM RECORDS</div><h1>{module}</h1><p>Manage and review your {module.toLowerCase()} records in one place.</p></div><button className="primary-button" onClick={onAdd}><Plus size={18}/> Add {module === 'Poultry' ? 'batch' : module === 'Tasks' ? 'task' : 'record'}</button></div>
    <div className="panel module-panel"><div className="module-toolbar"><div><h3>{module} register</h3><p>{rows.length} record{rows.length === 1 ? '' : 's'} shown</p></div><div className="search-box"><Search size={16}/><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search records…"/></div></div>
    {loading ? <div className="table-loading">Loading records…</div> : rows.length ? <div className="table-wrap"><table><thead><tr>{cols.map((c: string) => <th key={c}>{label(c)}</th>)}{module === 'Livestock' && <th>Actions</th>}</tr></thead><tbody>{rows.map((row: Row) => <tr key={row.id}>{cols.map((c: string) => <td key={c}>{c.includes('date') || c.endsWith('_on') || c.endsWith('_due') ? dateLabel(row[c]) : c === 'amount' || c.includes('cost') || c.includes('amount') || c === 'unit_price' ? currency(Number(row[c])) : c === 'status' || c === 'priority' ? <span className={`status-badge ${String(row[c]).toLowerCase() === 'active' || String(row[c]).toLowerCase() === 'completed' || String(row[c]).toLowerCase() === 'paid' ? 'success' : 'pending'}`}>{row[c] || '—'}</span> : row[c] == null || row[c] === '' ? '—' : String(row[c])}</td>)}{module === 'Livestock' && <td><button className="secondary-button livestock-edit-button" onClick={() => onEdit?.(row)}><Pencil size={14}/> Edit</button></td>}</tr>)}</tbody></table></div> : <EmptyState icon={<FileText size={22}/>} title={`No ${module.toLowerCase()} records yet`} text="Add your first record to start building a useful farm history." action={`Add ${module === 'Poultry' ? 'batch' : 'record'}`} onClick={onAdd}/>}</div>
    <footer className="footer"><span>© {new Date().getFullYear()} FarmPro Management</span><span><ShieldCheck size={14}/> Private farm workspace</span></footer>
  </div>
}

function EmptyState({ icon, title, text, action, onClick }: any) {
  return <div className="empty-state"><div className="empty-icon">{icon}</div><strong>{title}</strong><p>{text}</p>{action && <button className="secondary-button" onClick={onClick}><Plus size={16}/>{action}</button>}</div>
}

function RecordModal({ module, farmId, userId, editingRecord, onClose, onSaved }: any) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const saleSaveInProgress = useRef(false)
  const [values, setValues] = useState<Record<string,string>>((): Record<string,string> => {
    if (editingRecord) {
      return {
        species: editingRecord.species ?? '',
        tag_number: editingRecord.tag_number ?? '',
        name: editingRecord.name ?? '',
        breed: editingRecord.breed ?? '',
        sex: editingRecord.sex ?? '',
        date_of_birth: editingRecord.date_of_birth ?? '',
        acquired_on: editingRecord.acquired_on ?? '',
        acquisition_type: editingRecord.acquisition_type ?? '',
        purchase_cost: editingRecord.purchase_cost == null ? '' : String(editingRecord.purchase_cost),
        weight_kg: editingRecord.weight_kg == null ? '' : String(editingRecord.weight_kg),
        status: editingRecord.status ?? 'active',
        dam_id: editingRecord.dam_id ?? '',
        sire_id: editingRecord.sire_id ?? '',
        notes: editingRecord.notes ?? ''
      }
    }
    if (module === 'Sales') {
      return {
        sale_date: '',
        subtotal: '0',
        discount: '0',
        total_amount: '0',
        amount_paid: '0',
        status: 'unpaid',
        reference_no: '',
        payment_method: '',
        notes: ''
      }
    }
    return {
      species: '', tag_number: '', name: '', breed: '', sex: '', date_of_birth: '',
      acquired_on: '', acquisition_type: '', purchase_cost: '0', weight_kg: '',
      status: 'active', dam_id: '', sire_id: '', notes: ''
    }
  })
  const [saleItems, setSaleItems] = useState<SaleItemDraft[]>(() => module === 'Sales' ? [newSaleItemDraft()] : [])
  const [parentAnimals, setParentAnimals] = useState<Row[]>([])
  const [parentAnimalsLoading, setParentAnimalsLoading] = useState(false)
  const [parentAnimalsError, setParentAnimalsError] = useState('')
  const [tagPreview, setTagPreview] = useState('')
  const [tagPreviewLoading, setTagPreviewLoading] = useState(false)
  const [tagPreviewError, setTagPreviewError] = useState('')
  const previousFarmId = useRef(farmId)
  const [farmValues, setFarmValues] = useState({ name: '', location: '', phone: '', email: '', currency: 'UGX' })
  const [livestock, setLivestock] = useState<Row[]>([])
  const [poultryBatches, setPoultryBatches] = useState<Row[]>([])
  const [selectedLivestockId, setSelectedLivestockId] = useState('')
  const [selectedPoultryBatchId, setSelectedPoultryBatchId] = useState('')
  const [selectorsLoading, setSelectorsLoading] = useState(false)
  const [selectorsError, setSelectorsError] = useState('')
  const [customerFarms, setCustomerFarms] = useState<Row[]>([])
  const [selectedCustomerFarmId, setSelectedCustomerFarmId] = useState('')
  const [customerFarmsLoading, setCustomerFarmsLoading] = useState(false)
  const [customerFarmsError, setCustomerFarmsError] = useState('')
  const [saleCustomers, setSaleCustomers] = useState<Row[]>([])
  const [selectedSaleCustomerId, setSelectedSaleCustomerId] = useState('')
  const [saleCustomersLoading, setSaleCustomersLoading] = useState(false)
  const [saleCustomersError, setSaleCustomersError] = useState('')
  const [saleLivestock, setSaleLivestock] = useState<Row[]>([])
  const [salePoultryBatches, setSalePoultryBatches] = useState<Row[]>([])
  const [saleItemsLoading, setSaleItemsLoading] = useState(false)
  const [saleItemsError, setSaleItemsError] = useState('')
  const [supplierFarms, setSupplierFarms] = useState<Row[]>([])
  const [selectedSupplierFarmId, setSelectedSupplierFarmId] = useState('')
  const [supplierFarmsLoading, setSupplierFarmsLoading] = useState(false)
  const [supplierFarmsError, setSupplierFarmsError] = useState('')
  const [purchaseSuppliers, setPurchaseSuppliers] = useState<Row[]>([])
  const [selectedPurchaseSupplierId, setSelectedPurchaseSupplierId] = useState('')
  const [purchaseSuppliersLoading, setPurchaseSuppliersLoading] = useState(false)
  const [purchaseSuppliersError, setPurchaseSuppliersError] = useState('')
  const [feedFarms, setFeedFarms] = useState<Row[]>([])
  const [selectedFeedFarmId, setSelectedFeedFarmId] = useState('')
  const [feedFarmsLoading, setFeedFarmsLoading] = useState(false)
  const [feedFarmsError, setFeedFarmsError] = useState('')
  const [feedInventory, setFeedInventory] = useState<Row[]>([])
  const [selectedFeedInventoryId, setSelectedFeedInventoryId] = useState('')
  const [feedTargetLoading, setFeedTargetLoading] = useState(false)
  const [feedTargetError, setFeedTargetError] = useState('')
  const [breedingFarms, setBreedingFarms] = useState<Row[]>([])
  const [selectedBreedingFarmId, setSelectedBreedingFarmId] = useState('')
  const [breedingFarmsLoading, setBreedingFarmsLoading] = useState(false)
  const [breedingFarmsError, setBreedingFarmsError] = useState('')
  const [breedingLivestock, setBreedingLivestock] = useState<Row[]>([])
  const [breedingPoultry, setBreedingPoultry] = useState<Row[]>([])
  const [breedingTargetsLoading, setBreedingTargetsLoading] = useState(false)
  const [breedingTargetsError, setBreedingTargetsError] = useState('')
  const [selectedDamId, setSelectedDamId] = useState('')
  const [selectedSireId, setSelectedSireId] = useState('')
  const [selectedBreedingPoultryId, setSelectedBreedingPoultryId] = useState('')
  const table = moduleTables[module as ModuleKey] || ''
  const fields: Record<string,{key:string,label:string,type?:string,options?:string[]}[]> = {
    Livestock: [],
    Poultry: [{key:'batch_name',label:'Batch name'},{key:'bird_type',label:'Bird type',options:['layers','broilers','indigenous','breeders','other']},{key:'breed',label:'Breed'},{key:'start_date',label:'Start date',type:'date'},{key:'opening_count',label:'Starting bird count',type:'number'},{key:'current_count',label:'Current bird count',type:'number'}],
    Expenses: [{key:'category',label:'Category',options:['Feed','Veterinary','Labour','Transport','Utilities','Repairs','Other']},{key:'description',label:'Description'},{key:'amount',label:'Amount (UGX)',type:'number'},{key:'expense_date',label:'Date',type:'date'},{key:'payee',label:'Paid to'},{key:'payment_method',label:'Payment method',options:['Cash','Mobile Money','Bank transfer','Other']},{key:'notes',label:'Notes'}],
    Tasks: [{key:'title',label:'Task title'},{key:'category',label:'Category'},{key:'due_date',label:'Due date',type:'date'},{key:'priority',label:'Priority',options:['low','medium','high','urgent']},{key:'status',label:'Status',options:['pending','in_progress','completed','cancelled']},{key:'assigned_to',label:'Assigned to'}],
    Sales: [{key:'reference_no',label:'Reference number'},{key:'sale_date',label:'Sale date',type:'date'},{key:'subtotal',label:'Subtotal (UGX)',type:'number'},{key:'discount',label:'Discount (UGX)',type:'number'},{key:'total_amount',label:'Total amount (UGX)',type:'number'},{key:'amount_paid',label:'Amount paid (UGX)',type:'number'},{key:'status',label:'Sale status',options:['draft','completed','part_paid','unpaid','cancelled']},{key:'payment_method',label:'Payment method',options:['Cash','Mobile Money','Bank Transfer','Other']},{key:'notes',label:'Notes'}],
    Purchases: [{key:'category',label:'Category',options:['Feed','Medicine','Livestock','Equipment','Other']},{key:'description',label:'Description'},{key:'purchase_date',label:'Date',type:'date'},{key:'quantity',label:'Quantity',type:'number'},{key:'unit',label:'Unit (kg, bag, etc.)'},{key:'total_amount',label:'Total amount (UGX)',type:'number'},{key:'amount_paid',label:'Amount paid (UGX)',type:'number'},{key:'payment_status',label:'Payment status',options:['paid','part_paid','unpaid']}],
    'Feed & Inventory': [{key:'feed_name',label:'Feed name'},{key:'feed_type',label:'Feed type'},{key:'quantity',label:'Quantity',type:'number'},{key:'unit',label:'Unit (kg, bag, etc.)'},{key:'reorder_level',label:'Reorder level',type:'number'},{key:'unit_cost',label:'Unit cost (UGX)',type:'number'},{key:'supplier_name',label:'Supplier name'},{key:'expiry_date',label:'Expiry date',type:'date'},{key:'notes',label:'Notes'}],
    'Feed Logs': [{key:'fed_on',label:'Date',type:'date'},{key:'quantity',label:'Quantity',type:'number'},{key:'unit',label:'Unit (kg, bags, litres, etc.)'},{key:'cost',label:'Cost (UGX)',type:'number'},{key:'notes',label:'Notes'}],
    'Breeding Records': [{key:'species',label:'Species',options:['pig','cow','goat','poultry']},{key:'mating_date',label:'Mating date',type:'date'},{key:'expected_date',label:'Expected date',type:'date'},{key:'outcome_date',label:'Outcome date',type:'date'},{key:'outcome',label:'Outcome',options:['pregnant','born','failed','aborted','unknown']},{key:'offspring_count',label:'Offspring count',type:'number'},{key:'notes',label:'Notes'}],
    Customers: [{key:'name',label:'Customer name'},{key:'phone',label:'Phone'},{key:'email',label:'Email',type:'email'},{key:'address',label:'Address'},{key:'notes',label:'Notes'}],
    Suppliers: [{key:'name',label:'Supplier name'},{key:'phone',label:'Phone'},{key:'email',label:'Email',type:'email'},{key:'address',label:'Address'},{key:'notes',label:'Notes'}],
    Production: [{key:'production_type',label:'Production type',options:['eggs','milk','weight','manure','offspring','other']},{key:'recorded_on',label:'Date',type:'date'},{key:'quantity',label:'Quantity',type:'number'},{key:'unit',label:'Unit (litres, trays, kg, etc.)'},{key:'quality_grade',label:'Quality / grade'}],
    'Health & Breeding': [{key:'record_type',label:'Record type',options:['vaccination','treatment','checkup','illness','mortality','deworming','other']},{key:'condition_or_vaccine',label:'Condition / vaccine / treatment'},{key:'record_date',label:'Date',type:'date'},{key:'next_due_date',label:'Next due date',type:'date'},{key:'cost',label:'Cost (UGX)',type:'number'},{key:'administered_by',label:'Administered by'}]
  }
  const selectedFields = fields[module] || []
  const selectedMother = parentAnimals.find(animal => animal.id === values.dam_id)
  const selectedSire = parentAnimals.find(animal => animal.id === values.sire_id)
  const saleLineTotal = (item: SaleItemDraft) => {
    const quantity = Number(item.quantity)
    const unitPrice = Number(item.unit_price)
    return item.quantity.trim() && item.unit_price.trim() && Number.isFinite(quantity) && Number.isFinite(unitPrice)
      ? quantity * unitPrice
      : 0
  }
  const saleSubtotal = saleItems.reduce((sum, item) => sum + saleLineTotal(item), 0)
  const saleDiscount = Number(values.discount)
  const saleTotal = saleSubtotal - (Number.isFinite(saleDiscount) ? saleDiscount : 0)

  useEffect(() => {
    if (module !== 'Livestock') return
    if (!farmId) {
      setParentAnimals([])
      setParentAnimalsLoading(false)
      return
    }
    let cancelled = false
    async function loadParentAnimals() {
      setParentAnimalsLoading(true)
      setParentAnimalsError('')
      setParentAnimals([])
      const { data, error: queryError } = await supabase.from('livestock')
        .select('id, species, tag_number, name, sex, dam_id, sire_id')
        .eq('owner_id', userId)
        .eq('farm_id', farmId)
        .order('tag_number', { ascending: true })
      if (cancelled) return
      if (queryError) setParentAnimalsError(queryError.message)
      else setParentAnimals(data || [])
      setParentAnimalsLoading(false)
    }
    void loadParentAnimals()
    return () => { cancelled = true }
  }, [module, userId, farmId])

  useEffect(() => {
    if (previousFarmId.current !== farmId) {
      setValues(current => ({ ...current, dam_id: '', sire_id: '' }))
      previousFarmId.current = farmId
    }
  }, [farmId])

  useEffect(() => {
    if (module !== 'Livestock' || editingRecord || !farmId || !values.species) {
      setTagPreview('')
      setTagPreviewLoading(false)
      setTagPreviewError('')
      return
    }
    if (values.acquisition_type === 'born_on_farm' && !values.dam_id) {
      setTagPreview('')
      setTagPreviewLoading(false)
      setTagPreviewError('Select a mother to preview the maternal-lineage tag.')
      return
    }
    let cancelled = false
    async function loadTagPreview() {
      setTagPreviewLoading(true)
      setTagPreviewError('')
      const { data, error: previewError } = await supabase.rpc('preview_livestock_tag', {
        p_farm_id: farmId,
        p_species: values.species,
        p_dam_id: values.dam_id || null
      })
      if (cancelled) return
      if (previewError) {
        setTagPreview('')
        setTagPreviewError(previewError.message)
      } else {
        setTagPreview(String(data || ''))
      }
      setTagPreviewLoading(false)
    }
    void loadTagPreview()
    return () => { cancelled = true }
  }, [module, editingRecord, farmId, values.species, values.dam_id, values.acquisition_type])

  useEffect(() => {
    if (module !== 'Health & Breeding' && module !== 'Production') return
    if (!farmId) {
      setLivestock([])
      setPoultryBatches([])
      setSelectedLivestockId('')
      setSelectedPoultryBatchId('')
      setSelectorsLoading(false)
      return
    }
    let cancelled = false
    async function loadSelectors() {
      setSelectorsLoading(true)
      setSelectorsError('')
      setLivestock([])
      setPoultryBatches([])
      setSelectedLivestockId('')
      setSelectedPoultryBatchId('')
      const [livestockResult, poultryResult] = await Promise.all([
        supabase.from('livestock').select('id, tag_number, name, species').eq('owner_id', userId).eq('farm_id', farmId).eq('status', 'active').order('tag_number', { ascending: true }),
        supabase.from('poultry_batches').select('id, batch_name, bird_type').eq('owner_id', userId).eq('farm_id', farmId).eq('status', 'active').order('batch_name', { ascending: true })
      ])
      if (cancelled) return
      if (livestockResult.error || poultryResult.error) {
        setSelectorsError([livestockResult.error?.message, poultryResult.error?.message].filter(Boolean).join(' '))
      }
      setLivestock(livestockResult.data || [])
      setPoultryBatches(poultryResult.data || [])
      setSelectorsLoading(false)
    }
    void loadSelectors()
    return () => { cancelled = true }
  }, [module, userId, farmId])

  useEffect(() => {
    if (module !== 'Breeding Records') return
    if (!farmId) {
      setBreedingFarms([])
      setBreedingLivestock([])
      setBreedingPoultry([])
      setBreedingFarmsLoading(false)
      setBreedingTargetsLoading(false)
      return
    }
    let cancelled = false
    async function loadBreedingOptions() {
      setBreedingFarmsLoading(true)
      setBreedingTargetsLoading(true)
      setBreedingFarmsError('')
      setBreedingTargetsError('')
      setBreedingFarms([])
      setBreedingLivestock([])
      setBreedingPoultry([])
      setSelectedBreedingFarmId('')
      setSelectedDamId('')
      setSelectedSireId('')
      setSelectedBreedingPoultryId('')
      const [farmsResult, livestockResult, poultryResult] = await Promise.all([
        supabase.from('farms').select('id, name, location').eq('owner_id', userId).eq('id', farmId),
        supabase.from('livestock').select('id, tag_number, name, species').eq('owner_id', userId).eq('farm_id', farmId).order('tag_number', { ascending: true }),
        supabase.from('poultry_batches').select('id, batch_name, bird_type').eq('owner_id', userId).eq('farm_id', farmId).order('batch_name', { ascending: true })
      ])
      if (cancelled) return
      const farms = farmsResult.data || []
      setBreedingFarms(farms)
      setSelectedBreedingFarmId(current => current || (farms.some((item: Row) => item.id === farmId) ? farmId : farms[0]?.id || ''))
      setBreedingLivestock(livestockResult.data || [])
      setBreedingPoultry(poultryResult.data || [])
      const errors = [farmsResult.error?.message, livestockResult.error?.message, poultryResult.error?.message].filter(Boolean)
      if (errors.length) setBreedingTargetsError(errors.join(' '))
      if (farmsResult.error) setBreedingFarmsError(farmsResult.error.message)
      setBreedingFarmsLoading(false)
      setBreedingTargetsLoading(false)
    }
    void loadBreedingOptions()
    return () => { cancelled = true }
  }, [module, userId, farmId])

  useEffect(() => {
    if (module !== 'Customers') return
    if (!farmId) {
      setCustomerFarms([])
      setCustomerFarmsLoading(false)
      return
    }
    let cancelled = false
    async function loadCustomerFarms() {
      setCustomerFarmsLoading(true)
      setCustomerFarmsError('')
      setCustomerFarms([])
      setSelectedCustomerFarmId('')
      const { data, error: queryError } = await supabase.from('farms').select('id, name, location').eq('owner_id', userId).eq('id', farmId)
      if (cancelled) return
      const farms = data || []
      setCustomerFarms(farms)
      setSelectedCustomerFarmId(current => current || (farms.some((item: Row) => item.id === farmId) ? farmId : farms[0]?.id || ''))
      if (queryError) setCustomerFarmsError(queryError.message)
      setCustomerFarmsLoading(false)
    }
    void loadCustomerFarms()
    return () => { cancelled = true }
  }, [module, userId, farmId])

  useEffect(() => {
    if (module !== 'Sales') return
    if (!farmId) {
      setSaleCustomers([])
      setSelectedSaleCustomerId('')
      setSaleCustomersLoading(false)
      return
    }
    let cancelled = false
    async function loadSaleCustomers() {
      setSaleCustomersLoading(true)
      setSaleCustomersError('')
      setSaleCustomers([])
      setSelectedSaleCustomerId('')
      const { data, error: queryError } = await supabase.from('customers')
        .select('id, name')
        .eq('owner_id', userId)
        .eq('farm_id', farmId)
        .order('name', { ascending: true })
      if (cancelled) return
      if (queryError) setSaleCustomersError(queryError.message)
      else setSaleCustomers(data || [])
      setSaleCustomersLoading(false)
    }
    void loadSaleCustomers()
    return () => { cancelled = true }
  }, [module, userId, farmId])

  useEffect(() => {
    if (module !== 'Sales') return
    if (!farmId) {
      setSaleLivestock([])
      setSalePoultryBatches([])
      setSaleItemsLoading(false)
      return
    }
    let cancelled = false
    async function loadSaleItemRecords() {
      setSaleItemsLoading(true)
      setSaleItemsError('')
      setSaleLivestock([])
      setSalePoultryBatches([])
      const [livestockResult, poultryResult] = await Promise.all([
        supabase.from('livestock').select('id, tag_number, name, species')
          .eq('owner_id', userId).eq('farm_id', farmId).order('tag_number', { ascending: true }),
        supabase.from('poultry_batches').select('id, batch_name, bird_type')
          .eq('owner_id', userId).eq('farm_id', farmId).order('batch_name', { ascending: true })
      ])
      if (cancelled) return
      setSaleLivestock(livestockResult.data || [])
      setSalePoultryBatches(poultryResult.data || [])
      const queryErrors = [livestockResult.error?.message, poultryResult.error?.message].filter(Boolean)
      if (queryErrors.length) setSaleItemsError(queryErrors.join(' '))
      setSaleItemsLoading(false)
    }
    void loadSaleItemRecords()
    return () => { cancelled = true }
  }, [module, userId, farmId])

  useEffect(() => {
    if (module !== 'Feed Logs') return
    if (!farmId) {
      setFeedFarms([])
      setFeedInventory([])
      setLivestock([])
      setPoultryBatches([])
      setFeedFarmsLoading(false)
      setFeedTargetLoading(false)
      return
    }
    let cancelled = false
    async function loadFeedLogOptions() {
      setFeedFarmsLoading(true)
      setFeedTargetLoading(true)
      setFeedFarmsError('')
      setFeedTargetError('')
      setFeedFarms([])
      setFeedInventory([])
      setLivestock([])
      setPoultryBatches([])
      setSelectedFeedFarmId('')
      setSelectedFeedInventoryId('')
      setSelectedLivestockId('')
      setSelectedPoultryBatchId('')
      const [farmsResult, inventoryResult, livestockResult, poultryResult] = await Promise.all([
        supabase.from('farms').select('id, name, location').eq('owner_id', userId).eq('id', farmId),
        supabase.from('feed_inventory').select('id, feed_name, feed_type, unit, quantity').eq('owner_id', userId).eq('farm_id', farmId).order('feed_name', { ascending: true }),
        supabase.from('livestock').select('id, tag_number, name, species').eq('owner_id', userId).eq('farm_id', farmId).eq('status', 'active').order('tag_number', { ascending: true }),
        supabase.from('poultry_batches').select('id, batch_name, bird_type').eq('owner_id', userId).eq('farm_id', farmId).eq('status', 'active').order('batch_name', { ascending: true })
      ])
      if (cancelled) return
      const farms = farmsResult.data || []
      setFeedFarms(farms)
      setSelectedFeedFarmId(current => current || (farms.some((item: Row) => item.id === farmId) ? farmId : farms[0]?.id || ''))
      setFeedInventory(inventoryResult.data || [])
      setLivestock(livestockResult.data || [])
      setPoultryBatches(poultryResult.data || [])
      const errors = [farmsResult.error?.message, inventoryResult.error?.message, livestockResult.error?.message, poultryResult.error?.message].filter(Boolean)
      if (errors.length) setFeedTargetError(errors.join(' '))
      if (farmsResult.error) setFeedFarmsError(farmsResult.error.message)
      setFeedFarmsLoading(false)
      setFeedTargetLoading(false)
    }
    void loadFeedLogOptions()
    return () => { cancelled = true }
  }, [module, userId, farmId])

  useEffect(() => {
    if (module !== 'Suppliers') return
    if (!farmId) {
      setSupplierFarms([])
      setSupplierFarmsLoading(false)
      return
    }
    let cancelled = false
    async function loadSupplierFarms() {
      setSupplierFarmsLoading(true)
      setSupplierFarmsError('')
      setSupplierFarms([])
      setSelectedSupplierFarmId('')
      const { data, error: queryError } = await supabase.from('farms').select('id, name, location').eq('owner_id', userId).eq('id', farmId)
      if (cancelled) return
      const farms = data || []
      setSupplierFarms(farms)
      setSelectedSupplierFarmId(current => current || (farms.some((item: Row) => item.id === farmId) ? farmId : farms[0]?.id || ''))
      if (queryError) setSupplierFarmsError(queryError.message)
      setSupplierFarmsLoading(false)
    }
    void loadSupplierFarms()
    return () => { cancelled = true }
  }, [module, userId, farmId])

  useEffect(() => {
    if (module !== 'Purchases') return
    if (!farmId) {
      setPurchaseSuppliers([])
      setSelectedPurchaseSupplierId('')
      setPurchaseSuppliersLoading(false)
      return
    }
    let cancelled = false
    async function loadPurchaseSuppliers() {
      setPurchaseSuppliersLoading(true)
      setPurchaseSuppliersError('')
      setPurchaseSuppliers([])
      setSelectedPurchaseSupplierId('')
      const { data, error: queryError } = await supabase.from('suppliers')
        .select('id, name')
        .eq('owner_id', userId)
        .eq('farm_id', farmId)
        .order('name', { ascending: true })
      if (cancelled) return
      if (queryError) setPurchaseSuppliersError(queryError.message)
      else setPurchaseSuppliers(data || [])
      setPurchaseSuppliersLoading(false)
    }
    void loadPurchaseSuppliers()
    return () => { cancelled = true }
  }, [module, userId, farmId])

  async function saveFarm(e: FormEvent) {
    e.preventDefault(); setSaving(true); setError('')
    try {
      const { error: insertError } = await supabase.from('farms').insert({ ...farmValues, owner_id: userId })
      if (insertError) throw insertError
      await onSaved()
    } catch (e: any) { setError(e.message || 'Unable to create farm') }
    finally { setSaving(false) }
  }
  async function save(e: FormEvent) {
    e.preventDefault()
    if (module === 'Sales' && saleSaveInProgress.current) return
    setError('')
    if (!farmId) {
      setError('Select a farm before saving this record.')
      return
    }
    if (module === 'Livestock') {
      const species = values.species || ''
      const purchaseCost = String(values.purchase_cost ?? '').trim()
      const weightKg = String(values.weight_kg ?? '').trim()
      const validDecimal = (value: string) => value === '' || /^\d+(\.\d{1,2})?$/.test(value)
      if (!species) {
        setError('Species is required.')
        return
      }
      if (!['pig', 'cow', 'goat'].includes(species)) {
        setError('Choose a valid species.')
        return
      }
      if (!['', 'male', 'female', 'unknown'].includes(values.sex || '')) {
        setError('Choose a valid sex.')
        return
      }
      if (!['', 'born_on_farm', 'purchased', 'gifted', 'other'].includes(values.acquisition_type || '')) {
        setError('Choose a valid acquisition type.')
        return
      }
      if (!['active', 'sold', 'deceased', 'transferred'].includes(values.status || 'active')) {
        setError('Choose a valid status.')
        return
      }
      if (!validDecimal(purchaseCost) || !validDecimal(weightKg)) {
        setError('Purchase cost and weight must be non-negative numbers with up to two decimal places.')
        return
      }
      if (values.acquisition_type === 'born_on_farm' && !values.dam_id) {
        setError('Select the mother for an animal born on the farm.')
        return
      }
      if ((values.dam_id && values.dam_id === editingRecord?.id) || (values.sire_id && values.sire_id === editingRecord?.id)) {
        setError('An animal cannot be selected as its own parent.')
        return
      }
      if (values.dam_id && !parentAnimals.some(animal => animal.id === values.dam_id && animal.sex === 'female' && animal.species === species && animal.id !== editingRecord?.id)) {
        setError('Choose a female of the same species from the selected farm as the mother.')
        return
      }
      if (values.sire_id && !parentAnimals.some(animal => animal.id === values.sire_id && animal.sex === 'male' && animal.species === species && animal.id !== editingRecord?.id)) {
        setError('Choose a male of the same species from the selected farm as the father.')
        return
      }
      if (editingRecord) {
        const descendants = new Set<string>()
        const pending = [editingRecord.id]
        while (pending.length) {
          const parentId = pending.pop()!
          for (const child of parentAnimals) {
            if ((child.dam_id === parentId || child.sire_id === parentId) && !descendants.has(child.id)) {
              descendants.add(child.id)
              pending.push(child.id)
            }
          }
        }
        if ((values.dam_id && descendants.has(values.dam_id)) || (values.sire_id && descendants.has(values.sire_id))) {
          setError('This parent selection would create a circular family relationship.')
          return
        }
      }

      setSaving(true)
      try {
        const parentIds = [values.dam_id, values.sire_id].filter(Boolean)
        if (!(await verifyFarmRecordIds('livestock', userId, farmId, parentIds))) {
          throw new Error('Selected parents must belong to the currently selected farm.')
        }
        const payload = {
          species,
          name: String(values.name || '').trim() || null,
          breed: String(values.breed || '').trim() || null,
          sex: values.sex || null,
          date_of_birth: values.date_of_birth || null,
          acquired_on: values.acquired_on || null,
          acquisition_type: values.acquisition_type || null,
          purchase_cost: purchaseCost === '' ? 0 : Number(purchaseCost),
          weight_kg: weightKg === '' ? null : Number(weightKg),
          status: values.status || 'active',
          dam_id: values.dam_id || null,
          sire_id: values.sire_id || null,
          notes: String(values.notes || '').trim() || null
        }

        if (editingRecord) {
          const { data: updatedRecord, error: updateError } = await supabase.from('livestock').update(payload)
            .eq('id', editingRecord.id)
            .eq('owner_id', userId)
            .eq('farm_id', farmId)
            .select('id')
            .maybeSingle()
          if (updateError) {
              throw updateError
            }
            if (!updatedRecord) throw new Error('Livestock record was not found on the selected farm.')
        } else {
            const { error: insertError } = await supabase.rpc('create_livestock_with_tag', {
              p_farm_id: farmId,
              p_species: species,
              p_name: payload.name,
              p_breed: payload.breed,
              p_sex: payload.sex,
              p_date_of_birth: payload.date_of_birth,
              p_acquired_on: payload.acquired_on,
              p_acquisition_type: payload.acquisition_type,
              p_purchase_cost: payload.purchase_cost,
              p_weight_kg: payload.weight_kg,
              p_status: payload.status,
              p_dam_id: payload.dam_id,
              p_sire_id: payload.sire_id,
              p_notes: payload.notes
            })
            if (insertError) {
              if (insertError.code === '23505') throw new Error('The generated tag conflicts with an existing tag. Please try again.')
              throw insertError
            }
        }
        await onSaved()
      } catch (saveError: any) {
        setError(saveError.message || 'Unable to save livestock record.')
      } finally {
        setSaving(false)
      }
      return
    }
    if (module === 'Poultry') {
      const openingCount = String(values.opening_count ?? '').trim() === '' ? 0 : Number(values.opening_count)
      const currentCount = String(values.current_count ?? '').trim() === '' ? openingCount : Number(values.current_count)
      if (!Number.isSafeInteger(openingCount) || openingCount < 0 || !Number.isSafeInteger(currentCount) || currentCount < 0) {
        setError('Opening and current bird counts must be non-negative whole numbers.')
        return
      }
    }
    if ((module === 'Health & Breeding' || module === 'Production') && Boolean(selectedLivestockId) === Boolean(selectedPoultryBatchId)) {
      setError('Select exactly one target: either an individual livestock animal or a poultry batch, not both.')
      return
    }
    if ((module === 'Health & Breeding' || module === 'Production') &&
      ((selectedLivestockId && !livestock.some(item => item.id === selectedLivestockId)) ||
       (selectedPoultryBatchId && !poultryBatches.some(item => item.id === selectedPoultryBatchId)))) {
      setError('Selected livestock or poultry batch does not belong to the current farm.')
      return
    }
    if (module === 'Customers' && !selectedCustomerFarmId) {
      setError('Select a farm before saving the customer.')
      return
    }
    if (module === 'Customers' && selectedCustomerFarmId !== farmId) {
      setError('The customer must belong to the currently selected farm.')
      return
    }
    if (module === 'Suppliers' && !selectedSupplierFarmId) {
      setError('Select a farm before saving the supplier.')
      return
    }
    if (module === 'Suppliers' && selectedSupplierFarmId !== farmId) {
      setError('The supplier must belong to the currently selected farm.')
      return
    }
    if (module === 'Feed Logs' && !selectedFeedFarmId) {
      setError('Select a farm before saving the feed log.')
      return
    }
    if (module === 'Feed Logs' && !selectedFeedInventoryId) {
      setError('Select a feed inventory item before saving.')
      return
    }
    if (module === 'Feed Logs' && selectedFeedFarmId !== farmId) {
      setError('The feed log must belong to the currently selected farm.')
      return
    }
    if (module === 'Feed Logs' && !feedInventory.some(item => item.id === selectedFeedInventoryId)) {
      setError('Selected feed inventory item does not belong to the current farm.')
      return
    }
    if (module === 'Feed Logs' && Boolean(selectedLivestockId) === Boolean(selectedPoultryBatchId)) {
      setError('Select exactly one target: either a livestock animal or a poultry batch.')
      return
    }
    if (module === 'Feed Logs') {
      const quantity = Number(values.quantity)
      const cost = Number(values.cost)
      if (!String(values.quantity ?? '').trim() || !Number.isFinite(quantity) || quantity <= 0) {
        setError('Feed quantity must be a valid number greater than zero.')
        return
      }
      if (!String(values.cost ?? '').trim() || !Number.isFinite(cost) || cost < 0) {
        setError('Feed cost must be a valid non-negative amount.')
        return
      }
    }
    if (module === 'Feed Logs' &&
      ((selectedLivestockId && !livestock.some(item => item.id === selectedLivestockId)) ||
       (selectedPoultryBatchId && !poultryBatches.some(item => item.id === selectedPoultryBatchId)))) {
      setError('Selected livestock or poultry batch does not belong to the current farm.')
      return
    }
    if (module === 'Production') {
      const quantity = Number(values.quantity)
      if (!String(values.quantity ?? '').trim() || !Number.isFinite(quantity) || quantity <= 0) {
        setError('Production quantity must be a valid number greater than zero.')
        return
      }
      if (!String(values.unit ?? '').trim()) {
        setError('Enter a unit for the production quantity.')
        return
      }
    }
    if (module === 'Expenses') {
      const amount = Number(values.amount)
      if (!String(values.amount ?? '').trim() || !Number.isFinite(amount) || amount < 0) {
        setError('Expense amount must be a valid non-negative number.')
        return
      }
    }
    if (module === 'Purchases') {
      const quantity = Number(values.quantity)
      const totalAmount = Number(values.total_amount)
      const amountPaid = Number(values.amount_paid)
      if (!values.purchase_date || Number.isNaN(Date.parse(`${values.purchase_date}T00:00:00`))) {
        setError('Enter a valid purchase date.')
        return
      }
      if (!['Feed', 'Medicine', 'Livestock', 'Equipment', 'Other'].includes(values.category || '')) {
        setError('Choose a valid purchase category.')
        return
      }
      if (!String(values.description || '').trim()) {
        setError('Enter a purchase description.')
        return
      }
      if (!Number.isFinite(quantity) || quantity <= 0) {
        setError('Quantity must be a number greater than zero.')
        return
      }
      if (!String(values.unit || '').trim()) {
        setError('Enter a unit for the purchase quantity.')
        return
      }
      if (!String(values.total_amount ?? '').trim() || !Number.isFinite(totalAmount) || totalAmount <= 0) {
        setError('Total amount must be a valid amount greater than zero.')
        return
      }
      if (!String(values.amount_paid ?? '').trim() || !Number.isFinite(amountPaid) || amountPaid < 0 || amountPaid > totalAmount) {
        setError('Amount paid must be a valid amount between zero and the total amount.')
        return
      }
      if (!['paid', 'part_paid', 'unpaid'].includes(values.payment_status || '')) {
        setError('Choose a valid payment status.')
        return
      }
      if ((values.payment_status === 'paid' && amountPaid !== totalAmount) ||
        (values.payment_status === 'part_paid' && !(amountPaid > 0 && amountPaid < totalAmount)) ||
        (values.payment_status === 'unpaid' && amountPaid !== 0)) {
        setError('Purchase payment status must agree with the amount paid.')
        return
      }
      if (selectedPurchaseSupplierId && !purchaseSuppliers.some(supplier => supplier.id === selectedPurchaseSupplierId)) {
        setError('Choose a supplier belonging to the currently selected farm, or leave the supplier blank.')
        return
      }
    }
    if (module === 'Sales') {
      if (!saleItems.length) {
        setError('Add at least one sale item.')
        return
      }
      for (const [index, item] of saleItems.entries()) {
        if (!['livestock', 'poultry', 'eggs', 'milk', 'manure', 'other'].includes(item.item_type)) {
          setError(`Choose an item type for sale item ${index + 1}.`)
          return
        }
        const quantity = Number(item.quantity)
        const unitPrice = Number(item.unit_price)
        if (!item.quantity.trim() || !Number.isFinite(quantity) || quantity <= 0) {
          setError(`Sale item ${index + 1} quantity must be greater than zero.`)
          return
        }
        if (!item.unit.trim()) {
          setError(`Enter a unit for sale item ${index + 1}.`)
          return
        }
        if (!item.unit_price.trim() || !Number.isFinite(unitPrice) || unitPrice < 0 ||
          !Number.isFinite(quantity * unitPrice)) {
          setError(`Sale item ${index + 1} unit price must be a valid non-negative amount.`)
          return
        }
        if (item.item_type === 'livestock') {
          if (!item.livestock_id || !saleLivestock.some(animal => animal.id === item.livestock_id)) {
            setError(`Choose a livestock record for sale item ${index + 1}.`)
            return
          }
        } else if (item.item_type === 'poultry') {
          if (!item.poultry_batch_id || !salePoultryBatches.some(batch => batch.id === item.poultry_batch_id)) {
            setError(`Choose a poultry batch for sale item ${index + 1}.`)
            return
          }
        } else if (!item.description.trim()) {
          setError(`Enter a description for sale item ${index + 1}.`)
          return
        }
      }
      const saleDate = values.sale_date || ''
      const parsedSaleDate = new Date(`${saleDate}T00:00:00`)
      const subtotal = saleSubtotal
      const discount = Number(values.discount)
      const totalAmount = subtotal - discount
      const amountPaid = Number(values.amount_paid)
      const saleStatus = values.status || ''
      if (!/^\d{4}-\d{2}-\d{2}$/.test(saleDate) || Number.isNaN(parsedSaleDate.getTime()) || localDateString(parsedSaleDate) !== saleDate) {
        setError('Enter a valid sale date.')
        return
      }
      if (!String(values.subtotal ?? '').trim() || !Number.isFinite(subtotal) || subtotal < 0) {
        setError('Subtotal must be a valid non-negative amount.')
        return
      }
      if (!String(values.discount ?? '').trim() || !Number.isFinite(discount) || discount < 0 || discount > subtotal) {
        setError('Discount must be a valid amount between zero and the subtotal.')
        return
      }
      if (!Number.isFinite(totalAmount) || totalAmount < 0) {
        setError('Discount cannot exceed the item subtotal, and total amount cannot be negative.')
        return
      }
      if (!String(values.amount_paid ?? '').trim() || !Number.isFinite(amountPaid) || amountPaid < 0 || amountPaid > totalAmount) {
        setError('Amount paid must be a valid amount between zero and the total amount.')
        return
      }
      if (!['draft', 'completed', 'part_paid', 'unpaid', 'cancelled'].includes(saleStatus)) {
        setError('Choose a valid sale status.')
        return
      }
      if ((saleStatus === 'unpaid' && amountPaid !== 0) ||
        (saleStatus === 'part_paid' && !(amountPaid > 0 && amountPaid < totalAmount)) ||
        (saleStatus === 'completed' && amountPaid !== totalAmount)) {
        setError('Payment status must agree with the amount paid.')
        return
      }
      if (!selectedSaleCustomerId || !saleCustomers.some(customer => customer.id === selectedSaleCustomerId)) {
        setError('Select a customer belonging to the currently selected farm.')
        return
      }
    }
    if (module === 'Breeding Records') {
      if (!selectedBreedingFarmId) {
        setError('Select a farm before saving the breeding record.')
        return
      }
      if (selectedBreedingFarmId !== farmId) {
        setError('The breeding record must belong to the currently selected farm.')
        return
      }
      if ((selectedDamId && !breedingLivestock.some(item => item.id === selectedDamId)) ||
        (selectedSireId && !breedingLivestock.some(item => item.id === selectedSireId)) ||
        (selectedBreedingPoultryId && !breedingPoultry.some(item => item.id === selectedBreedingPoultryId))) {
        setError('Selected breeding animal or poultry batch does not belong to the current farm.')
        return
      }
      const breedingSpecies = values.species || ''
      if (!['pig', 'cow', 'goat', 'poultry'].includes(breedingSpecies)) {
        setError('Choose a valid breeding species: pig, cow, goat or poultry.')
        return
      }
      if (values.outcome && !['pregnant', 'born', 'failed', 'aborted', 'unknown'].includes(values.outcome)) {
        setError('Choose a valid breeding outcome.')
        return
      }
      if (breedingSpecies === 'poultry') {
        if (!selectedBreedingPoultryId || selectedDamId || selectedSireId) {
          setError('For poultry breeding, select a poultry batch only. Do not select livestock parents.')
          return
        }
      } else {
        if (selectedBreedingPoultryId) {
          setError('Select a poultry batch only when the breeding species is poultry.')
          return
        }
        if (selectedDamId && !breedingLivestock.some(item => item.id === selectedDamId && item.sex === 'female' && item.species === breedingSpecies)) {
          setError('The dam must be a female animal of the selected species on this farm.')
          return
        }
        if (selectedSireId && !breedingLivestock.some(item => item.id === selectedSireId && item.sex === 'male' && item.species === breedingSpecies)) {
          setError('The sire must be a male animal of the selected species on this farm.')
          return
        }
      }
      if (values.offspring_count !== undefined && values.offspring_count !== '') {
        const offspringCount = Number(values.offspring_count)
        if (!Number.isSafeInteger(offspringCount) || offspringCount < 0) {
          setError('Offspring count must be a non-negative whole number.')
          return
        }
      }
    }
    if (module === 'Sales') saleSaveInProgress.current = true
    setSaving(true)
    const payload: Row = { owner_id: userId, farm_id: farmId }
    selectedFields.forEach(f => {
      const value = values[f.key]
      if (value !== undefined) payload[f.key] = f.type === 'number' && value !== '' ? Number(value) : value
    })
    if (module === 'Poultry') {
      payload.status = 'active'
      payload.opening_count = String(values.opening_count ?? '').trim() === '' ? 0 : Number(values.opening_count)
      payload.current_count = String(values.current_count ?? '').trim() === '' ? payload.opening_count : Number(values.current_count)
    }
    if (module === 'Livestock') payload.status = 'active'
    if (module === 'Sales') {
      payload.customer_id = selectedSaleCustomerId
      payload.subtotal = saleSubtotal
      payload.total_amount = saleTotal
    }
    if (module === 'Purchases') {
      payload.unit_cost = Number(values.total_amount) / Number(values.quantity)
      payload.supplier_id = selectedPurchaseSupplierId || null
    }
    if (module === 'Tasks') payload.status = payload.status || 'pending'
    if (module === 'Health & Breeding' || module === 'Production') {
      if (selectedLivestockId) payload.livestock_id = selectedLivestockId
      if (selectedPoultryBatchId) payload.poultry_batch_id = selectedPoultryBatchId
    }
    if (module === 'Customers') payload.farm_id = selectedCustomerFarmId
    if (module === 'Suppliers') payload.farm_id = selectedSupplierFarmId
    if (module === 'Breeding Records') {
      payload.farm_id = selectedBreedingFarmId
      payload.species = String(values.species || '').trim()
      if (selectedDamId) payload.dam_livestock_id = selectedDamId
      if (selectedSireId) payload.sire_livestock_id = selectedSireId
      if (selectedBreedingPoultryId) payload.poultry_batch_id = selectedBreedingPoultryId
    }
    if (module === 'Feed Logs') {
      payload.farm_id = selectedFeedFarmId
      payload.feed_inventory_id = selectedFeedInventoryId
      if (selectedLivestockId) payload.livestock_id = selectedLivestockId
      if (selectedPoultryBatchId) payload.poultry_batch_id = selectedPoultryBatchId
    }
    try {
      if ((module === 'Health & Breeding' || module === 'Production') &&
        !(await verifyFarmRecordIds('livestock', userId, farmId, [selectedLivestockId]) &&
          await verifyFarmRecordIds('poultry_batches', userId, farmId, [selectedPoultryBatchId]))) {
        throw new Error('Selected livestock or poultry batch does not belong to the current farm.')
      }
      if (module === 'Feed Logs' &&
        !(await verifyFarmRecordIds('feed_inventory', userId, farmId, [selectedFeedInventoryId]) &&
          await verifyFarmRecordIds('livestock', userId, farmId, [selectedLivestockId]) &&
          await verifyFarmRecordIds('poultry_batches', userId, farmId, [selectedPoultryBatchId]))) {
        throw new Error('Selected feed inventory, livestock, or poultry batch does not belong to the current farm.')
      }
      if (module === 'Breeding Records' &&
        !(await verifyFarmRecordIds('livestock', userId, farmId, [selectedDamId, selectedSireId]) &&
          await verifyFarmRecordIds('poultry_batches', userId, farmId, [selectedBreedingPoultryId]))) {
        throw new Error('Selected breeding animal or poultry batch does not belong to the current farm.')
      }
      if (module === 'Purchases' &&
        !(await verifyFarmRecordIds('suppliers', userId, farmId, [selectedPurchaseSupplierId]))) {
        throw new Error('Selected supplier does not belong to the currently signed-in user and selected farm.')
      }
      if (module === 'Sales' &&
        !(await verifyFarmRecordIds('customers', userId, farmId, [selectedSaleCustomerId]))) {
        throw new Error('Selected customer does not belong to the currently signed-in user and selected farm.')
      }
      if (module === 'Sales') {
        const livestockIds = saleItems.filter(item => item.item_type === 'livestock').map(item => item.livestock_id)
        const poultryBatchIds = saleItems.filter(item => item.item_type === 'poultry').map(item => item.poultry_batch_id)
        if (!(await verifyFarmRecordIds('livestock', userId, farmId, livestockIds) &&
          await verifyFarmRecordIds('poultry_batches', userId, farmId, poultryBatchIds))) {
          throw new Error('A selected livestock record or poultry batch does not belong to the currently signed-in user and selected farm.')
        }
      }
      if (module === 'Sales') {
        const { data: sale, error: saleInsertError } = await supabase.from('sales').insert(payload).select('id').single()
        if (saleInsertError) throw saleInsertError
        if (!sale?.id) throw new Error('The sale was saved, but its generated ID could not be retrieved; sale items were not saved.')
        const saleItemsPayload = saleItems.map(item => {
          const livestock = item.item_type === 'livestock'
            ? saleLivestock.find(animal => animal.id === item.livestock_id)
            : null
          const poultry = item.item_type === 'poultry'
            ? salePoultryBatches.find(batch => batch.id === item.poultry_batch_id)
            : null
          const description = livestock
            ? [livestock.tag_number, livestock.name, livestock.species].filter(Boolean).join(' — ') || 'Livestock'
            : poultry
              ? [poultry.batch_name, poultry.bird_type].filter(Boolean).join(' — ') || 'Poultry'
              : item.description.trim()
          const quantity = Number(item.quantity)
          const unitPrice = Number(item.unit_price)
          return {
            owner_id: userId,
            sale_id: sale.id,
            item_type: item.item_type,
            description,
            quantity,
            unit: item.unit.trim(),
            unit_price: unitPrice,
            line_total: quantity * unitPrice,
            livestock_id: item.item_type === 'livestock' ? item.livestock_id : null,
            poultry_batch_id: item.item_type === 'poultry' ? item.poultry_batch_id : null
          }
        })
        const { error: itemsInsertError } = await supabase.from('sale_items').insert(saleItemsPayload)
        if (itemsInsertError) {
          const { data: removedSale, error: cleanupError } = await supabase.from('sales').delete()
            .eq('id', sale.id)
            .eq('owner_id', userId)
            .eq('farm_id', farmId)
            .select('id')
            .maybeSingle()
          if (cleanupError || !removedSale) {
            const cleanupMessage = cleanupError?.message || 'The newly created sale could not be confirmed as deleted.'
            throw new Error(`Sale items could not be saved (${itemsInsertError.message}). Cleanup also failed (${cleanupMessage}); the new sale may remain without its items.`)
          }
          throw new Error(`Sale items could not be saved. The newly created sale was removed. ${itemsInsertError.message}`)
        }
      } else {
        const { error: insertError } = await supabase.from(table).insert(payload)
        if (insertError) throw insertError
      }
      await onSaved()
    } catch (e: any) { setError(e.message || 'Unable to save record') }
    finally {
      setSaving(false)
      if (module === 'Sales') saleSaveInProgress.current = false
    }
  }
  return <div className="modal-backdrop" onClick={onClose}><div className={`modal ${module === 'Livestock' ? 'livestock-form-modal' : ''}`} onClick={e => e.stopPropagation()}><div className="modal-head"><div><span className="eyebrow">{editingRecord ? 'EDIT FARM RECORD' : 'NEW FARM RECORD'}</span><h2>{editingRecord ? `Edit ${module.toLowerCase()}` : `Add ${module === 'Poultry' ? 'poultry batch' : module.toLowerCase()}`}</h2></div><button className="icon-button" onClick={onClose}><X size={19}/></button></div>
    {!farmId ? <form onSubmit={saveFarm}><div className="setup-farm-note"><Sprout size={24}/><strong>First, tell us about your farm</strong><p>This creates your private farm profile. You can add livestock and other records right after.</p></div><div className="form-grid"><label className="field"><span>Farm name *</span><input required value={farmValues.name} onChange={e => setFarmValues({...farmValues,name:e.target.value})} placeholder="e.g. Green Valley Farm"/></label><label className="field"><span>Location</span><input value={farmValues.location} onChange={e => setFarmValues({...farmValues,location:e.target.value})} placeholder="District / village"/></label><label className="field"><span>Phone</span><input value={farmValues.phone} onChange={e => setFarmValues({...farmValues,phone:e.target.value})} placeholder="Contact number"/></label><label className="field"><span>Email</span><input type="email" value={farmValues.email} onChange={e => setFarmValues({...farmValues,email:e.target.value})} placeholder="Farm email (optional)"/></label><label className="field"><span>Currency</span><select value={farmValues.currency} onChange={e => setFarmValues({...farmValues,currency:e.target.value})}><option value="UGX">UGX — Ugandan Shilling</option><option value="USD">USD — US Dollar</option><option value="KES">KES — Kenyan Shilling</option><option value="TZS">TZS — Tanzanian Shilling</option></select></label></div>{error && <div className="form-error">{error}</div>}<div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button" disabled={saving}>{saving ? 'Creating farm…' : 'Create farm profile'}</button></div></form> :
    <form onSubmit={save}>{module === 'Livestock' ? <div className="livestock-form">
      <section className="livestock-form-section">
        <h3>Animal Identification</h3>
        <div className="livestock-form-grid">
          <label className="field"><span>Species *</span><select required value={values.species || ''} onChange={e => setValues({ ...values, species: e.target.value, dam_id: '', sire_id: '' })}><option value="">Choose species…</option><option value="pig">Pig</option><option value="cow">Cow</option><option value="goat">Goat</option></select></label>
          <label className="field livestock-tag-field"><span>Animal Tag (Automatically Generated)</span><input readOnly value={editingRecord?.tag_number || tagPreview} placeholder={editingRecord ? 'Existing tag unavailable' : 'Choose species to preview tag'}/><small>{editingRecord ? 'Existing animal tags cannot be changed.' : 'Preview only; the final tag is assigned when the record is successfully saved.'}</small>{tagPreviewLoading && !editingRecord && <small>Checking the next available tag…</small>}{tagPreviewError && !editingRecord && <small className="livestock-preview-error">Tag preview is unavailable: {tagPreviewError}. Saving will still request a database-assigned tag.</small>}</label>
          <label className="field"><span>Name</span><input value={values.name || ''} onChange={e => setValues({ ...values, name: e.target.value })} /></label>
          <label className="field"><span>Breed</span><input value={values.breed || ''} onChange={e => setValues({ ...values, breed: e.target.value })} /></label>
          <label className="field"><span>Sex</span><select value={values.sex || ''} onChange={e => setValues({ ...values, sex: e.target.value })}><option value="">Not specified</option><option value="male">Male</option><option value="female">Female</option><option value="unknown">Unknown</option></select></label>
        </div>
      </section>
      <section className="livestock-form-section">
        <h3>Animal History</h3>
        <div className="livestock-form-grid">
          <label className="field"><span>Date of Birth</span><input type="date" value={values.date_of_birth || ''} onChange={e => setValues({ ...values, date_of_birth: e.target.value })} /></label>
          <label className="field"><span>Acquisition Date</span><input type="date" value={values.acquired_on || ''} onChange={e => setValues({ ...values, acquired_on: e.target.value })} /></label>
          <label className="field"><span>Acquisition Type</span><select value={values.acquisition_type || ''} onChange={e => setValues({ ...values, acquisition_type: e.target.value })}><option value="">Not specified</option><option value="born_on_farm">Born on farm</option><option value="purchased">Purchased</option><option value="gifted">Gifted</option><option value="other">Other</option></select></label>
          <label className="field"><span>Purchase Cost</span><input type="number" min="0" step="0.01" value={values.purchase_cost ?? '0'} onChange={e => setValues({ ...values, purchase_cost: e.target.value })} /></label>
        </div>
      </section>
      <section className="livestock-form-section">
        <h3>Animal Details</h3>
        <div className="livestock-form-grid">
          <label className="field"><span>Weight (kg)</span><input type="number" min="0" step="0.01" value={values.weight_kg || ''} onChange={e => setValues({ ...values, weight_kg: e.target.value })} /></label>
          <label className="field"><span>Status</span><select value={values.status || 'active'} onChange={e => setValues({ ...values, status: e.target.value })}><option value="active">Active</option><option value="sold">Sold</option><option value="deceased">Deceased</option><option value="transferred">Transferred</option></select></label>
          <label className="field"><span>Mother{values.acquisition_type === 'born_on_farm' ? ' *' : ''}</span><select required={values.acquisition_type === 'born_on_farm'} disabled={parentAnimalsLoading} value={values.dam_id || ''} onChange={e => setValues({ ...values, dam_id: e.target.value })}><option value="">{parentAnimalsLoading ? 'Loading animals…' : values.acquisition_type === 'born_on_farm' ? 'Choose mother…' : 'Unknown / no mother'}</option>{parentAnimals.filter(animal => animal.sex === 'female' && animal.species === values.species && animal.id !== editingRecord?.id).map(animal => <option key={animal.id} value={animal.id}>{animal.tag_number}{animal.name ? ` — ${animal.name}` : ''}</option>)}</select></label>
          <label className="field"><span>Father</span><select disabled={parentAnimalsLoading} value={values.sire_id || ''} onChange={e => setValues({ ...values, sire_id: e.target.value })}><option value="">{parentAnimalsLoading ? 'Loading animals…' : 'Unknown / no father'}</option>{parentAnimals.filter(animal => animal.sex === 'male' && animal.species === values.species && animal.id !== editingRecord?.id).map(animal => <option key={animal.id} value={animal.id}>{animal.tag_number}{animal.name ? ` — ${animal.name}` : ''}</option>)}</select></label>
          <div className="livestock-lineage-summary"><strong>Maternal Lineage</strong><span>{selectedMother ? `${selectedMother.tag_number} → ${editingRecord?.tag_number || tagPreview || 'tag pending'}` : editingRecord ? 'No recorded mother' : 'No known mother; tag will use a farm and species sequence.'}</span>{selectedSire && <small>Father: {selectedSire.tag_number}{selectedSire.name ? ` — ${selectedSire.name}` : ''}</small>}</div>
          <label className="field livestock-notes"><span>Notes</span><textarea rows={3} value={values.notes || ''} onChange={e => setValues({ ...values, notes: e.target.value })} placeholder="Additional animal details"/></label>
        </div>
      </section>
      {!parentAnimalsLoading && !parentAnimalsError && <small className="livestock-parent-hint">Parent selectors list animals of the same species from the selected farm only. Mothers are female; fathers are male.</small>}
    </div> : <div className="form-grid">
      {module === 'Breeding Records' && <>
        <label className="field"><span>Farm *</span>
          {breedingFarmsLoading ? <select disabled><option>Loading farms…</option></select> : <select required value={selectedBreedingFarmId} onChange={e => setSelectedBreedingFarmId(e.target.value)}>
            <option value="">Choose a farm…</option>
            {breedingFarms.map(farmRow => <option key={farmRow.id} value={farmRow.id}>{farmRow.name || `Farm ${farmRow.id.slice(0, 8)}`}{farmRow.location ? ` — ${farmRow.location}` : ''}</option>)}
          </select>}
          <small>{breedingFarmsLoading ? '' : breedingFarms.length ? 'The breeding record will be saved to this farm.' : 'No farms found for your account.'}</small>
        </label>
        {values.species !== 'poultry' && <>
          <label className="field"><span>Dam livestock (optional)</span>
            {breedingTargetsLoading ? <select disabled><option>Loading livestock…</option></select> : <select value={selectedDamId} onChange={e => setSelectedDamId(e.target.value)}>
              <option value="">None selected</option>
              {breedingLivestock.filter(animal => animal.sex === 'female' && animal.species === values.species).map(animal => <option key={animal.id} value={animal.id}>{animal.tag_number || animal.name || animal.species || `Animal ${animal.id.slice(0, 8)}`}{animal.species ? ` — ${animal.species}` : ''}</option>)}
            </select>}
          </label>
          <label className="field"><span>Sire livestock (optional)</span>
            {breedingTargetsLoading ? <select disabled><option>Loading livestock…</option></select> : <select value={selectedSireId} onChange={e => setSelectedSireId(e.target.value)}>
              <option value="">None selected</option>
              {breedingLivestock.filter(animal => animal.sex === 'male' && animal.species === values.species).map(animal => <option key={animal.id} value={animal.id}>{animal.tag_number || animal.name || animal.species || `Animal ${animal.id.slice(0, 8)}`}{animal.species ? ` — ${animal.species}` : ''}</option>)}
            </select>}
          </label>
        </>}
        {values.species === 'poultry' && <label className="field"><span>Poultry batch *</span>
          {breedingTargetsLoading ? <select disabled><option>Loading poultry batches…</option></select> : <select required value={selectedBreedingPoultryId} onChange={e => setSelectedBreedingPoultryId(e.target.value)}>
            <option value="">Choose a poultry batch…</option>
            {breedingPoultry.map(batch => <option key={batch.id} value={batch.id}>{batch.batch_name || batch.bird_type || `Batch ${batch.id.slice(0, 8)}`}{batch.bird_type ? ` — ${batch.bird_type}` : ''}</option>)}
          </select>}
        </label>}
      </>}
      {module === 'Customers' && <label className="field"><span>Farm *</span>
        {customerFarmsLoading ? <select disabled><option>Loading farms…</option></select> : <select required value={selectedCustomerFarmId} onChange={e => setSelectedCustomerFarmId(e.target.value)}>
          <option value="">Choose a farm…</option>
          {customerFarms.map(farmRow => <option key={farmRow.id} value={farmRow.id}>{farmRow.name || `Farm ${farmRow.id.slice(0, 8)}`}{farmRow.location ? ` — ${farmRow.location}` : ''}</option>)}
        </select>}
        <small>{customerFarmsLoading ? '' : customerFarms.length ? 'The customer will be saved to this farm.' : 'No farms found for your account.'}</small>
      </label>}
      {module === 'Feed Logs' && <>
        <label className="field"><span>Farm *</span>
          {feedFarmsLoading ? <select disabled><option>Loading farms…</option></select> : <select required value={selectedFeedFarmId} onChange={e => setSelectedFeedFarmId(e.target.value)}>
            <option value="">Choose a farm…</option>
            {feedFarms.map(farmRow => <option key={farmRow.id} value={farmRow.id}>{farmRow.name || `Farm ${farmRow.id.slice(0, 8)}`}{farmRow.location ? ` — ${farmRow.location}` : ''}</option>)}
          </select>}
          <small>{feedFarmsLoading ? '' : feedFarms.length ? 'The feed log will be saved to this farm.' : 'No farms found for your account.'}</small>
        </label>
        <label className="field"><span>Feed inventory item *</span>
          {feedTargetLoading ? <select disabled><option>Loading feed inventory…</option></select> : <select required value={selectedFeedInventoryId} onChange={e => setSelectedFeedInventoryId(e.target.value)}>
            <option value="">Choose feed…</option>
            {feedInventory.map(feed => <option key={feed.id} value={feed.id}>{feed.feed_name || `Feed ${feed.id.slice(0, 8)}`}{feed.feed_type ? ` — ${feed.feed_type}` : ''}</option>)}
          </select>}
          <small>{feedTargetLoading ? '' : feedInventory.length ? 'Choose the feed item used.' : 'No feed inventory items found for your account.'}</small>
        </label>
        <label className="field"><span>Livestock animal</span>
          {feedTargetLoading ? <select disabled><option>Loading livestock…</option></select> : <select value={selectedLivestockId} onChange={e => setSelectedLivestockId(e.target.value)}>
            <option value="">None selected</option>
            {livestock.map(animal => <option key={animal.id} value={animal.id}>{animal.tag_number || animal.name || animal.species || `Animal ${animal.id.slice(0, 8)}`}{animal.species ? ` — ${animal.species}` : ''}</option>)}
          </select>}
          <small>{feedTargetLoading ? '' : livestock.length ? 'Select an animal, or select a poultry batch below.' : 'No active livestock records found.'}</small>
        </label>
        <label className="field"><span>Poultry batch</span>
          {feedTargetLoading ? <select disabled><option>Loading poultry batches…</option></select> : <select value={selectedPoultryBatchId} onChange={e => setSelectedPoultryBatchId(e.target.value)}>
            <option value="">None selected</option>
            {poultryBatches.map(batch => <option key={batch.id} value={batch.id}>{batch.batch_name || batch.bird_type || `Batch ${batch.id.slice(0, 8)}`}{batch.bird_type ? ` — ${batch.bird_type}` : ''}</option>)}
          </select>}
          <small>{feedTargetLoading ? '' : poultryBatches.length ? 'Select a batch, or select a livestock animal above.' : 'No active poultry batches found.'}</small>
        </label>
      </>}
      {module === 'Suppliers' && <label className="field"><span>Farm *</span>
        {supplierFarmsLoading ? <select disabled><option>Loading farms…</option></select> : <select required value={selectedSupplierFarmId} onChange={e => setSelectedSupplierFarmId(e.target.value)}>
          <option value="">Choose a farm…</option>
          {supplierFarms.map(farmRow => <option key={farmRow.id} value={farmRow.id}>{farmRow.name || `Farm ${farmRow.id.slice(0, 8)}`}{farmRow.location ? ` — ${farmRow.location}` : ''}</option>)}
        </select>}
        <small>{supplierFarmsLoading ? '' : supplierFarms.length ? 'The supplier will be saved to this farm.' : 'No farms found for your account.'}</small>
      </label>}
      {(module === 'Health & Breeding' || module === 'Production') && <>
        <label className="field"><span>Animal / livestock *</span>
          {selectorsLoading ? <select disabled><option>Loading animals…</option></select> : <select value={selectedLivestockId} onChange={e => setSelectedLivestockId(e.target.value)} aria-describedby="livestock-selector-help">
            <option value="">None selected</option>
            {livestock.map(animal => <option key={animal.id} value={animal.id}>{animal.tag_number || animal.name || animal.species || `Animal ${animal.id.slice(0, 8)}`}{animal.species ? ` — ${animal.species}` : ''}</option>)}
          </select>}
          <small id="livestock-selector-help">{livestock.length ? 'Choose one animal if this record applies to an individual.' : !selectorsLoading ? 'No active livestock records found for your account.' : ''}</small>
        </label>
        <label className="field"><span>Poultry batch (optional)</span>
          {selectorsLoading ? <select disabled><option>Loading poultry batches…</option></select> : <select value={selectedPoultryBatchId} onChange={e => setSelectedPoultryBatchId(e.target.value)}>
            <option value="">None selected</option>
            {poultryBatches.map(batch => <option key={batch.id} value={batch.id}>{batch.batch_name || batch.bird_type || `Batch ${batch.id.slice(0, 8)}`}{batch.bird_type ? ` — ${batch.bird_type}` : ''}</option>)}
          </select>}
          <small>{poultryBatches.length ? 'Choose a batch if this record applies to poultry.' : !selectorsLoading ? 'No active poultry batches found for your account.' : ''}</small>
        </label>
      </>}
      {module === 'Sales' && <label className="field"><span>Customer *</span>
        <select required disabled={saleCustomersLoading} value={selectedSaleCustomerId} onChange={e => setSelectedSaleCustomerId(e.target.value)}>
          <option value="">{saleCustomersLoading ? 'Loading customers…' : 'Choose a customer…'}</option>
          {saleCustomers.map(customer => <option key={customer.id} value={customer.id}>{customer.name || `Customer ${customer.id.slice(0, 8)}`}</option>)}
        </select>
        <small>{saleCustomersLoading ? '' : 'Customers are limited to your selected farm.'}</small>
      </label>}
      {module === 'Sales' && <section className="sale-items-section" style={{ gridColumn: '1 / -1', minWidth: 0 }}>
        <div className="module-toolbar">
          <div><h3>Sale Items</h3><p>Add the items included in this sale.</p></div>
          <button type="button" className="secondary-button" onClick={() => setSaleItems(current => [...current, newSaleItemDraft()])} disabled={saving}><Plus size={16}/> Add item</button>
        </div>
        {saleItemsLoading && <div className="table-loading">Loading same-farm livestock and poultry…</div>}
        {saleItems.map((item, index) => {
          const selectedAnimal = saleLivestock.find(animal => animal.id === item.livestock_id)
          const selectedBatch = salePoultryBatches.find(batch => batch.id === item.poultry_batch_id)
          return <div key={item.key} className="panel sale-item-row" style={{ padding: '16px', marginBottom: '12px' }}>
            <div className="module-toolbar">
              <strong>Item {index + 1}</strong>
              <button type="button" className="secondary-button" onClick={() => setSaleItems(current => current.filter(row => row.key !== item.key))} disabled={saving} aria-label={`Remove sale item ${index + 1}`}><X size={15}/> Remove</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))', gap: '12px' }}>
              <label className="field"><span>Item type *</span>
                <select required disabled={saving} value={item.item_type} onChange={e => setSaleItems(current => current.map(row => row.key === item.key ? { ...row, item_type: e.target.value, description: '', livestock_id: '', poultry_batch_id: '' } : row))}>
                  <option value="">Choose item type…</option>
                  {['livestock', 'poultry', 'eggs', 'milk', 'manure', 'other'].map(type => <option key={type} value={type}>{type[0].toUpperCase() + type.slice(1)}</option>)}
                </select>
              </label>
              {item.item_type === 'livestock' ? <>
                <label className="field"><span>Livestock record *</span>
                  <select required disabled={saving || saleItemsLoading} value={item.livestock_id} onChange={e => {
                    const animal = saleLivestock.find(row => row.id === e.target.value)
                    const description = animal ? [animal.tag_number, animal.name, animal.species].filter(Boolean).join(' — ') || 'Livestock' : ''
                    setSaleItems(current => current.map(row => row.key === item.key ? { ...row, livestock_id: e.target.value, description, poultry_batch_id: '' } : row))
                  }}>
                    <option value="">{saleItemsLoading ? 'Loading livestock…' : 'Choose livestock…'}</option>
                    {saleLivestock.map(animal => <option key={animal.id} value={animal.id}>{[animal.tag_number, animal.name, animal.species].filter(Boolean).join(' — ') || `Livestock ${animal.id.slice(0, 8)}`}</option>)}
                  </select>
                </label>
                <label className="field"><span>Description</span><input readOnly value={selectedAnimal ? [selectedAnimal.tag_number, selectedAnimal.name, selectedAnimal.species].filter(Boolean).join(' — ') || 'Livestock' : ''}/></label>
              </> : item.item_type === 'poultry' ? <>
                <label className="field"><span>Poultry batch *</span>
                  <select required disabled={saving || saleItemsLoading} value={item.poultry_batch_id} onChange={e => {
                    const batch = salePoultryBatches.find(row => row.id === e.target.value)
                    const description = batch ? [batch.batch_name, batch.bird_type].filter(Boolean).join(' — ') || 'Poultry' : ''
                    setSaleItems(current => current.map(row => row.key === item.key ? { ...row, poultry_batch_id: e.target.value, description, livestock_id: '' } : row))
                  }}>
                    <option value="">{saleItemsLoading ? 'Loading batches…' : 'Choose poultry batch…'}</option>
                    {salePoultryBatches.map(batch => <option key={batch.id} value={batch.id}>{[batch.batch_name, batch.bird_type].filter(Boolean).join(' — ') || `Batch ${batch.id.slice(0, 8)}`}</option>)}
                  </select>
                </label>
                <label className="field"><span>Description</span><input readOnly value={selectedBatch ? [selectedBatch.batch_name, selectedBatch.bird_type].filter(Boolean).join(' — ') || 'Poultry' : ''}/></label>
              </> : item.item_type && <label className="field"><span>Description *</span>
                <input required disabled={saving} value={item.description} onChange={e => setSaleItems(current => current.map(row => row.key === item.key ? { ...row, description: e.target.value } : row))}/>
              </label>}
              <label className="field"><span>Quantity *</span>
                <input type="number" min={Number.MIN_VALUE} step="any" required disabled={saving} value={item.quantity} onChange={e => setSaleItems(current => current.map(row => row.key === item.key ? { ...row, quantity: e.target.value } : row))}/>
              </label>
              <label className="field"><span>Unit *</span>
                <input required disabled={saving} value={item.unit} placeholder="e.g. head, tray, litre" onChange={e => setSaleItems(current => current.map(row => row.key === item.key ? { ...row, unit: e.target.value } : row))}/>
              </label>
              <label className="field"><span>Unit price (UGX) *</span>
                <input type="number" min="0" step="any" required disabled={saving} value={item.unit_price} onChange={e => setSaleItems(current => current.map(row => row.key === item.key ? { ...row, unit_price: e.target.value } : row))}/>
              </label>
              <div className="field"><span>Line total</span><strong>{currency(saleLineTotal(item))}</strong></div>
            </div>
          </div>
        })}
        <div className="module-toolbar"><span>{saleItems.length} item{saleItems.length === 1 ? '' : 's'}</span><strong>Subtotal: {currency(saleSubtotal)}</strong></div>
      </section>}
      {module === 'Purchases' && <label className="field"><span>Supplier</span>
        <select disabled={purchaseSuppliersLoading} value={selectedPurchaseSupplierId} onChange={e => setSelectedPurchaseSupplierId(e.target.value)}>
          <option value="">{purchaseSuppliersLoading ? 'Loading suppliers…' : 'No supplier selected'}</option>
          {purchaseSuppliers.map(supplier => <option key={supplier.id} value={supplier.id}>{supplier.name || `Supplier ${supplier.id.slice(0, 8)}`}</option>)}
        </select>
        <small>{purchaseSuppliersLoading ? '' : 'Suppliers are limited to your selected farm.'}</small>
      </label>}
      {selectedFields.map(f => {
        const requiredPurchaseField = module === 'Purchases' && ['category', 'description', 'purchase_date', 'quantity', 'unit', 'total_amount', 'amount_paid', 'payment_status'].includes(f.key)
        const requiredSaleField = module === 'Sales' && ['sale_date', 'subtotal', 'discount', 'total_amount', 'amount_paid', 'status'].includes(f.key)
        const requiredField = requiredPurchaseField || requiredSaleField || (module === 'Production' && f.key === 'unit') || ['tag_number','batch_name','category','description','amount','title','production_type','record_type','condition_or_vaccine','feed_name','name','species'].includes(f.key)
        const min = f.type === 'number' ? module === 'Purchases' && f.key === 'quantity' ? Number.MIN_VALUE : 0 : undefined
        if (module === 'Sales' && (f.key === 'subtotal' || f.key === 'total_amount')) {
          const amount = f.key === 'subtotal' ? saleSubtotal : saleTotal
          return <label key={f.key} className="field"><span>{f.label}</span><input type="number" readOnly value={Number.isFinite(amount) ? amount : ''}/></label>
        }
        return <label key={f.key} className="field"><span>{f.label}</span>{f.options ? <select required={requiredField} value={values[f.key] || ''} onChange={e => {
          const nextValue = e.target.value
          setValues(current => ({...current,[f.key]:nextValue}))
          if (module === 'Breeding Records' && f.key === 'species') {
            setSelectedDamId('')
            setSelectedSireId('')
            setSelectedBreedingPoultryId('')
          }
        }}><option value="">Choose…</option>{f.options.map(o => <option key={o} value={o}>{o.replace(/_/g,' ')}</option>)}</select> : <input required={requiredField} type={f.type || 'text'} min={module === 'Sales' && f.key === 'discount' ? 0 : min} max={module === 'Sales' && f.key === 'discount' ? saleSubtotal : undefined} step={f.type === 'number' ? 'any' : undefined} value={values[f.key] || ''} onChange={e => setValues({...values,[f.key]:e.target.value})}/>}</label>
      })}</div>}
      {selectorsError && (module === 'Health & Breeding' || module === 'Production') && <div className="form-error">Unable to load animal or poultry options: {selectorsError}</div>}
      {parentAnimalsError && module === 'Livestock' && <div className="form-error">Unable to load same-farm parent animals: {parentAnimalsError}</div>}
      {customerFarmsError && module === 'Customers' && <div className="form-error">Unable to load farms: {customerFarmsError}</div>}
      {saleCustomersError && module === 'Sales' && <div className="form-error">Unable to load customers: {saleCustomersError}</div>}
      {saleItemsError && module === 'Sales' && <div className="form-error">Unable to load livestock or poultry options: {saleItemsError}</div>}
      {supplierFarmsError && module === 'Suppliers' && <div className="form-error">Unable to load farms: {supplierFarmsError}</div>}
      {purchaseSuppliersError && module === 'Purchases' && <div className="form-error">Unable to load suppliers: {purchaseSuppliersError}</div>}
      {feedFarmsError && module === 'Feed Logs' && <div className="form-error">Unable to load farms: {feedFarmsError}</div>}
      {feedTargetError && module === 'Feed Logs' && <div className="form-error">Unable to load feed log options: {feedTargetError}</div>}
      {breedingFarmsError && module === 'Breeding Records' && <div className="form-error">Unable to load farms: {breedingFarmsError}</div>}
      {breedingTargetsError && module === 'Breeding Records' && <div className="form-error">Unable to load breeding relationships: {breedingTargetsError}</div>}
      {error && <div className="form-error">{error}</div>}<div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button" disabled={saving || selectorsLoading || parentAnimalsLoading || (module === 'Sales' && (saleCustomersLoading || saleItemsLoading)) || (module === 'Purchases' && purchaseSuppliersLoading) || (module === 'Feed Logs' && (feedFarmsLoading || feedTargetLoading)) || (module === 'Breeding Records' && (breedingFarmsLoading || breedingTargetsLoading))}>{saving ? 'Saving…' : module === 'Livestock' ? (editingRecord ? 'Save changes' : 'Save livestock') : 'Save record'}</button></div></form>}
  </div></div>
}

function AuthScreen({ mode, setMode, email, setEmail, password, setPassword, name, setName, onSubmit, busy, error }: any) {
  return <div className="auth-shell"><div className="auth-art"><div className="auth-brand"><div className="brand-mark"><Sprout size={24}/></div><div><strong>FarmPro</strong><span>MANAGEMENT</span></div></div><div className="auth-art-copy"><div className="eyebrow"><span className="live-dot"/> BUILT FOR YOUR FARM</div><h1>Grow smarter.<br/><em>Farm better.</em></h1><p>One calm, organised place to manage your animals, operations and farm finances.</p><div className="auth-feature-list"><span><CheckCircle2/> Livestock & poultry records</span><span><CheckCircle2/> Health, feed & production tracking</span><span><CheckCircle2/> Sales, expenses & insights</span></div></div><div className="auth-landscape"><div className="auth-sun"/><div className="auth-hill one"/><div className="auth-hill two"/><div className="auth-barn"><div/><span/></div></div><span className="auth-copyright">© {new Date().getFullYear()} FarmPro Management</span></div><div className="auth-main"><form className="auth-form" onSubmit={onSubmit}><span className="eyebrow">WELCOME TO FARMPro</span><h2>{mode === 'login' ? 'Welcome back' : 'Create your account'}</h2><p>{mode === 'login' ? 'Sign in to continue to your farm workspace.' : 'Start organising your farm operations today.'}</p>{mode === 'signup' && <label className="field"><span>Your name</span><input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Alex" /></label>}<label className="field"><span>Email address</span><input type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email"/></label><label className="field"><span>Password</span><input type="password" required minLength={6} value={password} onChange={e => setPassword(e.target.value)} placeholder="At least 6 characters" autoComplete={mode === 'login' ? 'current-password' : 'new-password'}/></label>{error && <div className="form-error">{error}</div>}<button className="primary-button auth-submit" disabled={busy}>{busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'} <ArrowUpRight size={17}/></button><div className="auth-switch">{mode === 'login' ? 'New to FarmPro?' : 'Already have an account?'} <button type="button" onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}>{mode === 'login' ? 'Create an account' : 'Sign in'}</button></div><div className="auth-security"><ShieldCheck size={16}/> Secure sign-in powered by Supabase</div></form></div></div>
}

function SetupScreen() {
  return <div className="setup-screen"><div className="brand-mark"><Sprout size={25}/></div><span className="eyebrow">ALMOST READY</span><h1>Connect your farm workspace</h1><p>Copy <code>.env.example</code> to <code>.env</code> and add your Supabase project publishable key. Then restart the development server.</p><div className="setup-steps"><div><b>1</b><span>Open the project folder in VS Code.</span></div><div><b>2</b><span>Rename <code>.env.example</code> to <code>.env</code>.</span></div><div><b>3</b><span>Paste your Supabase publishable key and run <code>npm install</code>, then <code>npm run dev</code>.</span></div></div></div>
}
