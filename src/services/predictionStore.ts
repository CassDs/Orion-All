import { ORION_ENGINE_VERSION } from '../domain/prediction'
import type { Match, MatchPrediction } from '../domain/types'

const DB_NAME = 'orion-prediction-db'
const DB_VERSION = 1
const STORE_NAME = 'frozen-predictions'

type StoredPrediction = MatchPrediction & {
  storageKey: string
}

const openDb = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'storageKey' })
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })

const keyFrom = (matchId: string, engineVersion = ORION_ENGINE_VERSION) => `${engineVersion}:${matchId}`

const transact = async <T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>) => {
  const db = await openDb()

  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, mode)
    const store = transaction.objectStore(STORE_NAME)
    const request = run(store)

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
    transaction.oncomplete = () => db.close()
    transaction.onerror = () => {
      db.close()
      reject(transaction.error)
    }
  })
}

export const getFrozenPrediction = async (matchId: string) => {
  const result = await transact<StoredPrediction | undefined>('readonly', (store) => store.get(keyFrom(matchId)))
  return result
}

export const saveFrozenPrediction = async (prediction: MatchPrediction) => {
  const stored: StoredPrediction = {
    ...prediction,
    storageKey: keyFrom(prediction.match.id, prediction.engineVersion),
  }

  await transact<IDBValidKey>('readwrite', (store) => store.put(stored))
  return stored
}

export const getOrCreateFrozenPrediction = async (
  match: Match,
  createPrediction: () => MatchPrediction,
): Promise<MatchPrediction> => {
  const stored = await getFrozenPrediction(match.id)

  if (stored) {
    return {
      ...stored,
      match,
    }
  }

  return saveFrozenPrediction(createPrediction())
}

export const getOrCreateFrozenPredictions = async (
  matches: Match[],
  createPrediction: (match: Match) => MatchPrediction,
  shouldFreeze: (match: Match) => boolean = () => true,
) => Promise.all(
  matches.map((match) => {
    if (!shouldFreeze(match)) return createPrediction(match)
    return getOrCreateFrozenPrediction(match, () => createPrediction(match))
  }),
)