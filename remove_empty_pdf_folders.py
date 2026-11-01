from pathlib import Path


def remove_empty_folders(root: Path) -> int:
    removed_count = 0

    for folder in sorted(root.rglob("*"), key=lambda path: len(path.parts), reverse=True):
        if not folder.is_dir():
            continue

        try:
            folder.rmdir()
        except OSError:
            continue

        print(f"Removed: {folder}")
        removed_count += 1

    return removed_count


if __name__ == "__main__":
    pdf_root = Path(__file__).parent / "data" / "pdfs"
    removed_count = remove_empty_folders(pdf_root)
    print(f"Removed {removed_count} empty folder(s).")