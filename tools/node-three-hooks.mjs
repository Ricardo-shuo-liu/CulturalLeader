// 让 Node 解析浏览器 importmap 里的裸标识符 three / three/addons/*
// 指向 frontend/vendor 中的本地副本，从而可以在无 node_modules 的情况下做逻辑校验。

const VENDOR = new URL('../frontend/vendor/', import.meta.url);

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'three') {
    return { url: new URL('three/build/three.module.js', VENDOR).href, shortCircuit: true };
  }
  if (specifier.startsWith('three/addons/')) {
    const rest = specifier.slice('three/addons/'.length);
    return { url: new URL(`three/examples/jsm/${rest}`, VENDOR).href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
