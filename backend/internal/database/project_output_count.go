package database

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
)

// countProjectOutputImages 与画布一致，只统计去重后的最终输出图片。
func countProjectOutputImages(archive []byte) (int64, error) {
	reader, err := zip.NewReader(bytes.NewReader(archive), int64(len(archive)))
	if err != nil {
		return 0, fmt.Errorf("open project archive: %w", err)
	}
	for _, file := range reader.File {
		if file.Name != "manifest.json" {
			continue
		}
		if file.UncompressedSize64 > maxProjectManifestBytes {
			return 0, errors.New("project manifest is too large")
		}
		content, err := file.Open()
		if err != nil {
			return 0, fmt.Errorf("open project manifest: %w", err)
		}
		data, readErr := io.ReadAll(io.LimitReader(content, maxProjectManifestBytes+1))
		closeErr := content.Close()
		if readErr != nil {
			return 0, fmt.Errorf("read project manifest: %w", readErr)
		}
		if closeErr != nil {
			return 0, fmt.Errorf("close project manifest: %w", closeErr)
		}
		if len(data) > maxProjectManifestBytes {
			return 0, errors.New("project manifest is too large")
		}
		var manifest struct {
			Tasks []struct {
				OutputImages []string `json:"outputImages"`
			} `json:"tasks"`
		}
		if err := json.Unmarshal(data, &manifest); err != nil {
			return 0, fmt.Errorf("decode project manifest: %w", err)
		}
		ids := make(map[string]struct{})
		for _, task := range manifest.Tasks {
			for _, id := range task.OutputImages {
				if id != "" {
					ids[id] = struct{}{}
				}
			}
		}
		return int64(len(ids)), nil
	}
	// 新建项目尚未保存任务时使用空 ZIP。
	if len(reader.File) == 0 {
		return 0, nil
	}
	return 0, errors.New("project manifest not found")
}
