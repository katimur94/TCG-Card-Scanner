import { useEffect, useState } from 'react';
import { guessImageBase, imageUrl, loadSets } from '../../lib/api';
import type { SetInfo } from '../../lib/types';
import type { StackOption } from '../../state/stack';

/** Set-Infos zu einer Karte (aus dem Offline-Index). */
export function useSet(o: { group: string; setId: string } | null | undefined): SetInfo | undefined {
  const [set, setSet] = useState<SetInfo | undefined>();
  useEffect(() => {
    if (!o) return;
    let alive = true;
    loadSets().then((idx) => alive && setSet(idx.byId.get(`${o.group}:${o.setId}`)));
    return () => {
      alive = false;
    };
  }, [o?.group, o?.setId]); // eslint-disable-line react-hooks/exhaustive-deps
  return set;
}

/** Bildquellen einer Karte ohne API-Aufruf: Kartensprache, dann Englisch. */
export function useThumbs(o: StackOption | null | undefined, lang: string, quality: 'low' | 'high' = 'low'): string[] {
  const set = useSet(o);
  if (!o || !set) return [];
  const langs = o.group === 'ja' ? ['ja'] : [lang, 'en'].filter((l, i, a) => l && l !== 'ja' && a.indexOf(l) === i);
  return langs.map((l) => imageUrl(guessImageBase(l, set, o.localId), quality)).filter((x): x is string => !!x);
}

/** Objekt-URL für ein Blob (wird freigegeben). */
export function useBlobUrl(blob: Blob | null | undefined) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) {
      setUrl(null);
      return;
    }
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return url;
}
