// ============================================================
// AssetLibrary — 美术资源读取层（引擎式 AssetDatabase）
// 资源随 room_created / room_joined / game_data 一次性下发（进房/试玩时填充），
// 渲染时按 id 直查：实例 → prefab → faces → sprite。
// 无归属反查、无歧义；永不参与 state_sync 同步。
// ============================================================

import type { GameAssets, Prefab, Sprite } from "../engine";

export class AssetLibrary {
  private sprites = new Map<string, Sprite>();   // sprite id → sprite
  private prefabs = new Map<string, Prefab>();   // prefab id → prefab

  constructor(assets: GameAssets) {
    for (const s of assets.sprites) this.sprites.set(s.id, s);
    for (const p of assets.prefabs) this.prefabs.set(p.id, p);
  }

  /** 按 sprite id 取图片资源 */
  getSprite(spriteId: string): Sprite | undefined {
    return this.sprites.get(spriteId);
  }

  /** 按 prefab id 取实体模板 */
  getPrefab(prefabId: string): Prefab | undefined {
    return this.prefabs.get(prefabId);
  }

  /**
   * 便捷：prefab → [正面url, 背面url]。
   * prefab 或正面 sprite 缺失 → undefined（渲染回退默认样式）；
   * 背面缺失 → 空串（渲染回退默认卡背）。
   */
  getPrefabFaces(prefabId: string): [string, string] | undefined {
    const prefab = this.prefabs.get(prefabId);
    if (!prefab) return undefined;
    const front = this.sprites.get(prefab.faces.front);
    if (!front) return undefined;
    return [front.url, this.sprites.get(prefab.faces.back)?.url ?? ""];
  }

  /** 渲染尺寸（缺省 120×168 卡牌） */
  getPrefabSize(prefabId: string): { width: number; height: number } | undefined {
    return this.prefabs.get(prefabId)?.size;
  }
}

let library: AssetLibrary | null = null;

/** 填充/覆盖资源库（进房、重连、试玩时调用） */
export function setAssets(assets: GameAssets): void {
  library = new AssetLibrary(assets);
}

/** 按 prefab id 取正反 url（渲染用）。未填充或不存在返回 undefined */
export function getPrefabFaces(prefabId: string): [string, string] | undefined {
  return library?.getPrefabFaces(prefabId);
}

/** 按 prefab id 取渲染尺寸（缺省 120×168 卡牌） */
export function getPrefabSize(prefabId: string): { width: number; height: number } | undefined {
  return library?.getPrefabSize(prefabId);
}
