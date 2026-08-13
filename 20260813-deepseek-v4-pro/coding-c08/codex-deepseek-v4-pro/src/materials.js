// 材质注册表（与 maps.js 内部一致，供角色/武器使用）
import * as THREE from "three";
import { texCamo, texMetal } from "./util.js";

const cache = new Map();

export function getMaterial(name) {
  if (cache.has(name)) return cache.get(name);
  let m;
  switch (name) {
    case "camoT": m = new THREE.MeshStandardMaterial({ map: texCamo("#8a7448", ["#6f5a33", "#a08a55", "#58472a"]), color: 0xffffff, roughness: 0.95 }); break;
    case "camoCT": m = new THREE.MeshStandardMaterial({ map: texCamo("#54687f", ["#42536a", "#6a7f98", "#33404f"]), color: 0xffffff, roughness: 0.95 }); break;
    case "skin": m = new THREE.MeshStandardMaterial({ map: texCamo("#b98a68", ["#a37758", "#c79a76"]), color: 0xffffff, roughness: 0.85 }); break;
    case "metalDark": m = new THREE.MeshStandardMaterial({ map: texMetal(), color: 0x555a60, roughness: 0.6, metalness: 0.6 }); break;
    default: m = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.9 });
  }
  cache.set(name, m);
  return m;
}
