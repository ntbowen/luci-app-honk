# luci-app-honk

OpenWrt 上的 honk（eBPF 透明代理引擎，dae 兼容）LuCI 管理界面与二进制包。

本仓库包含三个包：

- `honk`：从 [daeuniverse/honk](https://github.com/daeuniverse/honk) 的
  GitHub Release 按目标架构下载预编译静态 `honk-core`，不在本地编译。
- `luci-app-honk`：LuCI 页面（服务 → honk），提供 UCI 开关、
  `/etc/honk/config.dae` 及其 include 文件的语法高亮编辑器、服务日志。
  移植自 [daeuniverse/openwrt-packages](https://github.com/daeuniverse/openwrt-packages)。
- `luci-lib-daeuniverse`：上述页面依赖的共享视图库，也可供
  `luci-app-dae` 复用，附带 zh_Hans/zh_Hant 翻译。

## 使用

把本仓库放入 OpenWrt 源码树的 `package/` 下：

```bash
git clone https://github.com/ntbowen/luci-app-honk package/honk
```

然后：

```bash
make menuconfig
# LuCI -> Applications -> luci-app-honk（自动带上 luci-lib-daeuniverse 与 honk）
make package/honk/luci-app-honk/compile V=s
```

honk 目前只提供 `x86_64` 与 `aarch64` 的静态 musl 二进制，因此包通过
`@(x86_64||aarch64)` 限制架构。

## 配置

默认配置在 `/etc/honk/config.dae`，拆分配置位于
`/etc/honk/config.d/{node,route,dns}.dae`。首次使用前请替换示例节点与订阅。

## 版本号

`scripts/update_honk_version.sh` 会读取 daeuniverse/honk 最新 Release，
把 tag（如 `v0.0.1.beta.49`）清洗成同时满足 ipk 与 apk 的版本
（`0.0.1_beta49`），并写回 `honk/Makefile`。
