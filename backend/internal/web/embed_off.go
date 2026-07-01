//go:build !embed

package web

import "io/fs"

// 未启用 embed tag（如本地 go run / 单元测试）：使用空 FS，
// 无需先构建前端产物即可编译启动，前端资源交由 vite dev server 提供。
var DistFS fs.FS = nil
