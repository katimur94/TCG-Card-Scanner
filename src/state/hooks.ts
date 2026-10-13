import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState } from 'react';
import { db, type CollectionItem } from '../db/schema';
import { depotOf, dayChange } from '../domain/valuation';
import { portfolioHistory } from '../domain/collection';

const EMPTY: CollectionItem[] = [];

export function useItems(): CollectionItem[] {
  return useLiveQuery(() => db.collection_items.toArray(), [], EMPTY) ?? EMPTY;
}

export function useDepot() {
  const items = useItems();
  const history = useLiveQuery(() => portfolioHistory(), [], []);
  return useMemo(() => {
    const depot = depotOf(items);
    return { items, depot, history: history ?? [], day: dayChange(history ?? [], depot.valueCents) };
  }, [items, history]);
}

/** Objekt-URL für ein gespeichertes Foto (wird beim Verlassen freigegeben). */
export function usePhotoUrl(photoId: string | null | undefined) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!photoId) {
      setUrl(null);
      return;
    }
    let u: string | null = null;
    let alive = true;
    db.photos.get(photoId).then((p) => {
      if (!alive || !p) return;
      u = URL.createObjectURL(p.blob);
      setUrl(u);
    });
    return () => {
      alive = false;
      if (u) URL.revokeObjectURL(u);
    };
  }, [photoId]);
  return url;
}
