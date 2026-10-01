import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider'
import { useEffect, useReducer, useState } from 'react'
import type * as Y from 'yjs'
import { COLLAB_PATH, type AwarenessUser, type PresenceState, type Role } from '../../../shared/protocol.ts'

export function createSocket() {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
  return new HocuspocusProviderWebsocket({ url: `${proto}://${window.location.host}${COLLAB_PATH}` })
}

export function openDoc(
  socket: HocuspocusProviderWebsocket,
  name: string,
  token: string,
  handlers: { onAuthenticationFailed?: () => void } = {},
) {
  const provider = new HocuspocusProvider({
    websocketProvider: socket,
    name,
    token,
    onAuthenticationFailed: handlers.onAuthenticationFailed,
  })
  provider.attach() // required when sharing one websocket between documents
  return provider
}

export type Awareness = NonNullable<HocuspocusProvider['awareness']>

/** Re-render whenever a Yjs type (or anything nested inside it) changes. */
export function useYObserve(type: Y.AbstractType<any> | null | undefined) {
  const [, bump] = useReducer((x: number) => x + 1, 0)
  useEffect(() => {
    if (!type) return
    type.observeDeep(bump)
    return () => type.unobserveDeep(bump)
  }, [type])
}

export interface Peer extends PresenceState {
  clientId: number
}

/** Remote awareness states (excluding our own client). */
function readPeers(awareness: Awareness | null | undefined): Peer[] {
  const list: Peer[] = []
  awareness?.getStates().forEach((state, clientId) => {
    if (clientId !== awareness.clientID && state.user) list.push({ clientId, ...(state as PresenceState) })
  })
  return list
}

export function usePeers(awareness: Awareness | null | undefined): Peer[] {
  const [peers, setPeers] = useState<Peer[]>(() => readPeers(awareness))
  useEffect(() => {
    if (!awareness) return
    const update = () => setPeers(readPeers(awareness))
    update()
    awareness.on('change', update)
    return () => awareness.off('change', update)
  }, [awareness])
  return peers
}

export function useSynced(provider: HocuspocusProvider | null) {
  const [synced, setSynced] = useState(!!provider?.isSynced)
  useEffect(() => {
    if (!provider) return
    const update = () => setSynced(provider.isSynced)
    update()
    provider.on('synced', update)
    return () => {
      provider.off('synced', update)
    }
  }, [provider])
  return synced
}

export function useConnectionStatus(socket: HocuspocusProviderWebsocket | null) {
  const [status, setStatus] = useState<string>(socket?.status ?? 'connecting')
  useEffect(() => {
    if (!socket) return
    const update = ({ status }: { status: string }) => setStatus(status)
    socket.on('status', update)
    return () => {
      socket.off('status', update)
    }
  }, [socket])
  return status
}

const PALETTE = ['#4dabf7', '#69db7c', '#da77f2', '#ffd43b', '#38d9a9', '#f783ac', '#a9e34b', '#74c0fc']
export const TUTOR_COLOR = '#ff922b'

export function makeUser(name: string, role: Role): AwarenessUser {
  let color = TUTOR_COLOR
  if (role === 'tutee') {
    let h = 0
    for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0
    color = PALETTE[h % PALETTE.length]
  }
  return { name, color, colorLight: color + '40', role }
}
