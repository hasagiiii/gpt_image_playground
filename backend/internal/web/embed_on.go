//go:build embed

package web

import (
	"embed"
	"io/fs"
)

// 构建时（-tags embed）嵌入前端产物。dist/ 由 Docker 构建阶段从仓库根拷入本目录。
//
//go:embed all:dist
var distEmbed embed.FS

// DistFS 指向嵌入产物中的 dist 子目录。
var DistFS fs.FS = mustSub(distEmbed, "dist")

func mustSub(e embed.FS, dir string) fs.FS {
	sub, err := fs.Sub(e, dir)
	if err != nil {
		panic(err)
	}
	return sub
}
