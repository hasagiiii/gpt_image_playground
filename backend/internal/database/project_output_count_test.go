package database

import (
	"encoding/json"
	"testing"
)

func TestCountProjectOutputImages(t *testing.T) {
	for _, tc := range []struct {
		name     string
		manifest string
		want     int64
	}{
		{"empty", `{"tasks":[]}`, 0},
		{"legacy without tasks", `{"version":4}`, 0},
		{"null outputs", `{"tasks":[{}, {"outputImages":null}]}`, 0},
		{"final outputs only", `{
			"projects":[{"canvas":{"items":{"orphan":{},"task-a:error":{}}}}],
			"tasks":[
				{"status":"done","inputImageIds":["ref-a","ref-b"],"maskTargetImageId":"target",
				 "maskImageId":"mask","transparentOriginalImages":["original"],"streamPartialImageIds":["partial"],
				 "outputImages":["image-a","image-b"]},
				{"status":"error","outputImages":[],"outputErrors":[{"requestIndex":0}]}
			],
			"agentConversations":[{"rounds":[{"inputImageIds":["agent-ref"]}]}]
		}`, 2},
		{"deduplicate across tasks", `{"tasks":[{"outputImages":["a","a","b"]},{"outputImages":["a","c",""]}]}`, 3},
		{"partial success and running outputs", `{"tasks":[{"status":"error","outputImages":["a"]},{"status":"running","outputImages":["b"]}]}`, 2},
	} {
		t.Run(tc.name, func(t *testing.T) {
			count, err := countProjectOutputImages(projectArchiveForTest(t, tc.manifest))
			if err != nil || count != tc.want {
				t.Fatalf("want %d outputs, got %d, err=%v", tc.want, count, err)
			}
		})
	}
	if count, err := countProjectOutputImages(emptyProjectArchive); err != nil || count != 0 {
		t.Fatalf("want 0 outputs for new project, got %d, err=%v", count, err)
	}
}

func TestCountProjectOutputImagesRejectsInvalidArchive(t *testing.T) {
	for _, archive := range [][]byte{
		[]byte("invalid zip"),
		projectArchiveForTest(t, `{invalid json`),
		projectArchiveForTest(t, `{"tasks":[{"outputImages":[42]}]}`),
	} {
		if _, err := countProjectOutputImages(archive); err == nil {
			t.Fatal("invalid archive must not be reported as zero outputs")
		}
	}
}

func TestCountProjectOutputImagesAfterTaskChanges(t *testing.T) {
	archive := projectArchiveForTest(t, `{"tasks":[{"id":"task-a","outputImages":["old"]},{"id":"task-b","outputImages":["b"]}]}`)
	updated, err := rewriteProjectTaskArchive(archive, nil, json.RawMessage(`{"id":"task-a","outputImages":["a","b","c"]}`), "task-a", false)
	if err != nil {
		t.Fatal(err)
	}
	if count, err := countProjectOutputImages(updated); err != nil || count != 3 {
		t.Fatalf("want 3 outputs after replacement, got %d, err=%v", count, err)
	}
	deleted, err := rewriteProjectTaskArchive(updated, nil, nil, "task-a", true)
	if err != nil {
		t.Fatal(err)
	}
	if count, err := countProjectOutputImages(deleted); err != nil || count != 1 {
		t.Fatalf("want 1 output after deletion, got %d, err=%v", count, err)
	}
}
