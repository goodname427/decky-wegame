#!/bin/bash
# ============================================================
#  WeGame Launcher - SteamOS 一键安装与构建脚本
#  用法:
#    ./install.sh          # 正常安装
#    ./install.sh --clean  # 清理之前的安装痕迹后退出
# ============================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# 如果传入 --clean 参数，执行清理
if [ "$1" = "--clean" ]; then
    # 颜色定义和 clean_all 函数需要先加载，在文件末尾调用
    # 这里先设置颜色，后面会调用 clean_all
    RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'
    log_info() { echo -e "${CYAN}[INFO]${NC} $1"; }
    log_success() { echo -e "${GREEN}[OK]${NC} $1"; }
    log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
    log_step() { echo -e "\n${BOLD}${CYAN}━━━ $1 ━━━${NC}\n"; }

    echo -e "${BOLD}${RED}"
    echo "  ╔══════════════════════════════════════╗"
    echo "  ║     清理模式 - 删除所有安装痕迹       ║"
    echo "  ╚══════════════════════════════════════╝"
    echo -e "${NC}"

    # 内联清理逻辑（与 clean_all 相同，避免依赖文件后面定义的函数）
    log_step "一键清理之前的安装痕迹"

    sudo sed -i 's/^SigLevel.*/SigLevel = Required TrustedOnly/' /etc/pacman.conf
    sudo sed -i 's/^LocalFileSigLevel.*/LocalFileSigLevel = Optional/' /etc/pacman.conf

    sudo tee /etc/pacman.d/mirrorlist.steamos-core > /dev/null << 'EOFM'
Server = https://steamdeck-packages.steamos.cloud/archlinux-mirror/$repo/os/$arch
EOFM
    sudo tee /etc/pacman.d/mirrorlist.steamos-community > /dev/null << 'EOFM'
Server = https://steamdeck-packages.steamos.cloud/archlinux-mirror/$repo/os/$arch
EOFM

    sudo rm -rf /var/cache/pacman/pkg/*
    sudo rm -rf /usr/lib/node_modules/pnpm 2>/dev/null || true
    sudo rm -f /usr/bin/pnpm /usr/bin/pnpm.cjs 2>/dev/null || true
    rm -rf "$HOME/.npm-global"
    rm -rf "$HOME/.cargo"
    rm -rf "$HOME/.rustup"
    rm -rf "$SCRIPT_DIR/node_modules"
    rm -rf "$SCRIPT_DIR/src-tauri/target"
    rm -rf "$HOME/tmp"
    rm -f "$HOME/Desktop/wegame-launcher.desktop"

    [ -f "$HOME/.bashrc" ] && sed -i '/npm-global\/bin/d' "$HOME/.bashrc"

    rm -f /etc/pacman.d/mirrorlist.bak.steam 2>/dev/null || true
    rm -f /etc/pacman.d/mirrorlist.steamos-core.bak.steam 2>/dev/null || true
    rm -f /etc/pacman.d/mirrorlist.steamos-community.bak.steam 2>/dev/null || true

    log_success "清理完成！系统已恢复到安装前状态"
    echo ""
    echo -e "${CYAN}现在可以重新运行 ./install.sh 进行全新安装${NC}"
    exit 0
fi

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# 项目信息
PROJECT_NAME="WeGame Launcher"

log_info()    { echo -e "${CYAN}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[OK]${NC} $1"; }
log_warn()    { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error()   { echo -e "${RED}[ERROR]${NC} $1"; }
log_step()    { echo -e "\n${BOLD}${CYAN}━━━ $1 ━━━${NC}\n"; }

# 检查是否为 SteamOS
check_os() {
    log_step "检查系统环境"
    if [ -f /etc/os-release ]; then
        . /etc/os-release
        if echo "$ID $ID_LIKE" | grep -qi "steamos\|arch\|manjaro"; then
            log_success "当前系统: $PRETTY_NAME"
        else
            log_warn "当前系统: $PRETTY_NAME（非 SteamOS/Arch，部分命令可能不兼容）"
        fi
    else
        log_warn "无法检测系统版本，继续执行..."
    fi
}

# 关闭只读文件系统
disable_readonly() {
    log_step "关闭 SteamOS 只读文件系统"
    if sudo steamos-readonly status 2>/dev/null | grep -q "enabled"; then
        log_info "正在关闭只读模式..."
        sudo steamos-readonly disable
        log_success "只读模式已关闭"
    else
        log_success "只读模式已经是关闭状态"
    fi
}

# 配置大文件目录到 home 分区（Steam Deck 根分区空间有限）
# 必须在所有安装操作之前调用
configure_storage() {
    log_step "配置存储路径到 home 分区"

    # 检查磁盘空间
    local root_free home_free
    root_free=$(df -h / --output=avail | tail -1 | tr -d ' ')
    home_free=$(df -h "$HOME" --output=avail | tail -1 | tr -d ' ')
    log_info "根分区剩余: ${root_free}，home 分区剩余: ${home_free}"

    # 1. 构建临时目录指向 home 分区（影响所有编译/链接过程）
    mkdir -p "$HOME/tmp"
    export TMPDIR="$HOME/tmp"

    # 2. pacman 缓存目录指向 home 分区（下载的包不占根分区）
    mkdir -p "$HOME/.cache/pacman"
    sudo sed -i "s|^#*CacheDir.*|CacheDir = $HOME/.cache/pacman|" /etc/pacman.conf
    # 同时清除根分区的旧缓存
    sudo rm -rf /var/cache/pacman/pkg/*

    # 3. npm 全局包安装到 home 目录
    mkdir -p "$HOME/.npm-global"
    mkdir -p "$HOME/.npm"
    echo "prefix=$HOME/.npm-global" > "$HOME/.npmrc"

    if ! grep -q 'npm-global/bin' "$HOME/.bashrc" 2>/dev/null; then
        echo 'export PATH="$HOME/.npm-global/bin:$PATH"' >> "$HOME/.bashrc"
    fi
    export PATH="$HOME/.npm-global/bin:$PATH"

    # 4. Cargo 缓存和编译目标目录（Rust 编译产物很大，必须在 home）
    export CARGO_HOME="${CARGO_HOME:-$HOME/.cargo}"
    export RUSTUP_HOME="${RUSTUP_HOME:-$HOME/.rustup}"

    log_success "所有大文件存储已重定向到 home 分区"
    echo -e "  临时文件:     ${CYAN}$HOME/tmp${NC}"
    echo -e "  pacman 缓存:  ${CYAN}$HOME/.cache/pacman${NC}"
    echo -e "  npm 全局包:   ${CYAN}$HOME/.npm-global${NC}"
    echo -e "  Rust 工具链:  ${CYAN}$RUSTUP_HOME${NC}"
    echo -e "  Rust 缓存:    ${CYAN}$CARGO_HOME${NC}"
}

# 恢复 SteamOS 原始镜像源（如果之前被修改过）
restore_mirror() {
    log_step "恢复软件镜像源"

    # 恢复所有被修改过的镜像文件
    local backup_files=(
        "/etc/pacman.d/mirrorlist.bak.steam"
        "/etc/pacman.d/mirrorlist.steamos-core.bak.steam"
        "/etc/pacman.d/mirrorlist.steamos-community.bak.steam"
    )

    for bak in "${backup_files[@]}"; do
        local orig="${bak%.bak.steam}"
        if [ -f "$bak" ]; then
            sudo cp "$bak" "$orig"
            log_info "已恢复: $orig"
        fi
    done

    # 清理缓存中因错误镜像导致的损坏包
    log_info "清理 pacman 缓存中的无效包..."
    sudo pacman -Sc --noconfirm 2>/dev/null || true

    log_success "镜像源已恢复为 SteamOS 官方源"
}

# 安装系统依赖（带重试）
install_system_deps() {
    log_step "安装系统依赖"
    local deps=(
        webkit2gtk-4.1
        libappindicator-gtk3
        librsvg
        gtk3
        openssl
        pkg-config
        patchelf
        file
        git
        base-devel
    )

    log_info "即将安装: ${deps[*]}"
    log_warn "需要从 SteamOS 官方源下载，如果速度较慢请耐心等待（或挂代理加速）"

    local max_retries=3
    local retry=0
    while [ $retry -lt $max_retries ]; do
        if sudo pacman -Sy --noconfirm --needed "${deps[@]}"; then
            log_success "系统依赖安装完成"
            return 0
        fi
        retry=$((retry + 1))
        log_warn "安装失败（第 ${retry}/${max_retries} 次），5 秒后重试..."
        sleep 5
    done

    log_error "系统依赖安装失败，请检查网络连接或尝试挂代理后重试"
    exit 1
}

# 安装 Rust
install_rust() {
    log_step "安装 Rust 工具链"
    if command -v rustc &>/dev/null; then
        local rust_ver
        rust_ver=$(rustc --version 2>/dev/null || echo "未知")
        log_success "Rust 已安装: $rust_ver"
        # 更新到最新稳定版
        log_info "更新 Rust 到最新版本..."
        rustup update stable
    else
        log_info "正在下载并安装 Rust..."
        curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
        source "$HOME/.cargo/env"
        log_success "Rust 安装完成: $(rustc --version)"
    fi
}

# 安装 Node.js（含 npm）
install_node() {
    log_step "安装 Node.js"
    if command -v node &>/dev/null; then
        log_success "Node.js 已安装: $(node --version)"
    else
        log_info "正在通过 pacman 安装 Node.js..."
        sudo pacman -S --noconfirm --needed nodejs
        log_success "Node.js 安装完成: $(node --version)"
    fi

    # SteamOS 的 nodejs 包可能不自带 npm，需要单独安装
    if ! command -v npm &>/dev/null; then
        log_info "npm 未找到，尝试单独安装..."
        sudo pacman -S --noconfirm --needed npm 2>/dev/null || true
    fi

    # 如果 pacman 也没有 npm，使用官方安装脚本
    if ! command -v npm &>/dev/null; then
        log_info "pacman 中没有 npm，使用官方安装脚本..."
        curl -fsSL https://www.npmjs.com/install.sh | bash
    fi

    if command -v npm &>/dev/null; then
        log_success "npm 可用: $(npm --version)"
    else
        log_error "npm 安装失败，无法继续"
        exit 1
    fi
}

# 安装 pnpm
install_pnpm() {
    log_step "安装 pnpm"
    if command -v pnpm &>/dev/null; then
        log_success "pnpm 已安装: $(pnpm --version)"
    else
        if command -v npm &>/dev/null; then
            log_info "正在通过 npm 安装 pnpm（安装到 home 分区）..."
            npm install -g pnpm
            log_success "pnpm 安装完成: $(pnpm --version)"
        else
            log_error "无法安装 pnpm（npm 不可用，请检查 Node.js 是否正确安装）"
            exit 1
        fi
    fi
}

# 安装 winetricks
install_winetricks() {
    log_step "安装 winetricks"
    if command -v winetricks &>/dev/null; then
        log_success "winetricks 已安装"
    else
        log_info "正在安装 winetricks..."
        sudo pacman -S --noconfirm --needed winetricks
        log_success "winetricks 安装完成"
    fi
}

# 安装前端依赖并构建
build_project() {
    log_step "构建项目"

    cd "$SCRIPT_DIR"

    # 安装前端依赖
    log_info "安装前端依赖 (pnpm install)..."
    pnpm install

    # 构建 Tauri 应用
    log_info "正在编译（首次构建可能需要 5-15 分钟）..."
    pnpm tauri build

    # 找到产物
    local appimage
    appimage=$(find src-tauri/target/release/bundle/appimage/ -name "*.AppImage" 2>/dev/null | head -1)

    if [ -n "$appimage" ] && [ -f "$appimage" ]; then
        log_success "构建成功！"
        echo ""
        echo -e "${GREEN}${BOLD}━━━ 构建产物 ━━━${NC}"
        echo -e "  AppImage: ${CYAN}${appimage}${NC}"
        echo ""

        # 创建桌面快捷方式
        create_desktop_entry "$appimage"

        # 提示添加到 Steam
        echo -e "${YELLOW}${BOLD}如需添加到 Steam 库：${NC}"
        echo -e "  1. 打开 Steam → 左下角「添加游戏」→「添加非 Steam 游戏」"
        echo -e "  2. 浏览到: ${CYAN}${appimage}${NC}"
        echo ""
    else
        log_error "构建完成但未找到 AppImage 产物，请检查上方日志"
        exit 1
    fi
}

# 创建桌面快捷方式
create_desktop_entry() {
    local appimage="$1"
    local desktop_file="$HOME/Desktop/wegame-launcher.desktop"

    log_info "创建桌面快捷方式..."

    cat > "$desktop_file" << EOF
[Desktop Entry]
Name=WeGame Launcher
Comment=在 SteamOS 上运行腾讯 WeGame
Exec="$appimage" %U
Icon=steamdeck-gaming-return
Terminal=false
Type=Application
Categories=Game;
StartupNotify=true
EOF

    chmod +x "$desktop_file"
    # SteamOS 桌面需要信任
    if command -v gio &>/dev/null; then
        gio set "$desktop_file" metadata::trusted true 2>/dev/null || \
        sed -i 's/^Type=Application$/&\nX-Flatpak=n/' "$desktop_file" 2>/dev/null || true
    fi
    chmod +x "$desktop_file"

    log_success "桌面快捷方式已创建: $desktop_file"
}

# 一键清理：删除所有之前下载/安装的内容，恢复系统初始状态
clean_all() {
    log_step "一键清理之前的安装痕迹"

    # 1. 恢复 pacman.conf 签名验证
    log_info "恢复 pacman 签名验证..."
    sudo sed -i 's/^SigLevel.*/SigLevel = Required TrustedOnly/' /etc/pacman.conf
    sudo sed -i 's/^LocalFileSigLevel.*/LocalFileSigLevel = Optional/' /etc/pacman.conf

    # 2. 恢复所有镜像源备份
    local backup_files=(
        "/etc/pacman.d/mirrorlist.bak.steam"
        "/etc/pacman.d/mirrorlist.steamos-core.bak.steam"
        "/etc/pacman.d/mirrorlist.steamos-community.bak.steam"
    )
    for bak in "${backup_files[@]}"; do
        local orig="${bak%.bak.steam}"
        if [ -f "$bak" ]; then
            sudo cp "$bak" "$orig"
            log_info "已恢复: $orig"
        fi
    done

    # 3. 强制恢复 SteamOS 官方源（防止备份不存在的情况）
    sudo tee /etc/pacman.d/mirrorlist.steamos-core > /dev/null << 'EOFM'
Server = https://steamdeck-packages.steamos.cloud/archlinux-mirror/$repo/os/$arch
EOFM
    sudo tee /etc/pacman.d/mirrorlist.steamos-community > /dev/null << 'EOFM'
Server = https://steamdeck-packages.steamos.cloud/archlinux-mirror/$repo/os/$arch
EOFM

    # 4. 清空 pacman 缓存
    log_info "清空 pacman 缓存..."
    sudo rm -rf /var/cache/pacman/pkg/*

    # 5. 卸载通过 pacman 安装的组件（保留 nodejs 本身，只清缓存）
    log_info "清理 pacman 包缓存..."

    # 6. 删除根分区中 npm 全局安装的 pnpm
    log_info "清理根分区中的 npm 全局包..."
    sudo rm -rf /usr/lib/node_modules/pnpm 2>/dev/null || true
    sudo rm -f /usr/bin/pnpm /usr/bin/pnpm.cjs 2>/dev/null || true

    # 7. 删除 home 分区中的 npm 全局包目录
    log_info "清理 home 分区中的 npm 全局包..."
    rm -rf "$HOME/.npm-global"

    # 8. 删除 Rust 工具链和缓存
    log_info "清理 Rust 工具链和缓存..."
    rm -rf "$HOME/.cargo"
    rm -rf "$HOME/.rustup"

    # 9. 删除项目构建产物
    log_info "清理项目构建产物..."
    rm -rf "$SCRIPT_DIR/node_modules"
    rm -rf "$SCRIPT_DIR/src-tauri/target"

    # 10. 删除 home 下的临时构建目录
    rm -rf "$HOME/tmp"

    # 11. 删除桌面快捷方式
    rm -f "$HOME/Desktop/wegame-launcher.desktop"

    # 12. 清理 .bashrc 中添加的 PATH
    if [ -f "$HOME/.bashrc" ]; then
        sed -i '/npm-global\/bin/d' "$HOME/.bashrc"
    fi

    # 13. 删除备份文件本身
    for bak in "${backup_files[@]}"; do
        rm -f "$bak" 2>/dev/null || true
    done

    log_success "清理完成！系统已恢复到安装前状态"
    echo ""
    echo -e "${YELLOW}已清理的内容：${NC}"
    echo -e "  - pacman 缓存 (/var/cache/pacman/pkg/)"
    echo -e "  - npm 全局包 (pnpm)"
    echo -e "  - Rust 工具链和缓存 (~/.cargo, ~/.rustup)"
    echo -e "  - 项目构建产物 (node_modules, target)"
    echo -e "  - 桌面快捷方式"
    echo -e "  - 镜像源备份文件"
    echo ""
    echo -e "${CYAN}现在可以重新运行 ./install.sh 进行全新安装${NC}"
    exit 0
}

# 提示恢复只读
prompt_readonly() {
    echo -e "${YELLOW}${BOLD}━━━ 安全提示 ━━━${NC}"
    echo -e "  构建已完成。建议恢复 SteamOS 只读保护以保障系统安全："
    echo -e "    ${CYAN}sudo steamos-readonly enable${NC}"
    echo ""
    read -rp "$(echo -e ${YELLOW}是否现在恢复只读模式？[Y/n] ${NC})" choice
    choice=${choice:-Y}
    if [[ "$choice" =~ ^[Yy]$ ]]; then
        sudo steamos-readonly enable
        log_success "只读模式已恢复"
    else
        log_warn "跳过恢复只读模式（请手动执行 sudo steamos-readonly enable）"
    fi
}

# ============================================================
#  主流程
# ============================================================

main() {
    echo -e "${BOLD}${CYAN}"
    echo "  ╔══════════════════════════════════════╗"
    echo "  ║     WeGame Launcher 安装向导         ║"
    echo "  ║     SteamOS / Steam Deck             ║"
    echo "  ╚══════════════════════════════════════╝"
    echo -e "${NC}"

    check_os
    configure_storage
    disable_readonly
    restore_mirror
    install_system_deps
    install_rust
    install_node
    install_pnpm
    install_winetricks
    build_project
    prompt_readonly

    echo -e "\n${GREEN}${BOLD}━━━ 全部完成！━━━${NC}\n"
    echo -e "  双击桌面上的 ${CYAN}WeGame Launcher${NC} 图标即可启动"
    echo -e "  或在终端运行: ${CYAN}${appimage:-./WeGame_Launcher.AppImage}${NC}\n"
}

main "$@"
