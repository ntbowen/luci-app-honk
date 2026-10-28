#
# OpenWrt package: luci-lib-daeuniverse
#
# The LuCI page luci-app-dae and luci-app-honk share: service status with the
# UCI switch, an editor with syntax highlighting for the configuration file and
# every file it includes (one tab per file, each saved to its own path), and
# the service log. The apps only describe their service.
#
# This file is free software, licensed under the GNU General Public License v3
# or later.

include $(TOPDIR)/rules.mk

PKG_LICENSE:=GPL-3.0-or-later

LUCI_TITLE:=Shared LuCI page for dae and honk
LUCI_DEPENDS:=+luci-base
LUCI_PKGARCH:=all
# jsmin strips '//' inside string literals; keep sources verbatim.
LUCI_MINIFY_JS:=0

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature
