/** Cancel is a no-op: the mutation is called only after explicit confirmation. */
export function confirmCalendarDelete(title: string, id: string | undefined, confirm: (message: string) => boolean, remove: (id: string) => void): void {
  if (!id) return
  if (!confirm(`删除发布计划「${title}」？取消不会删除，关联成片也不会被删除。`)) return
  remove(id)
}
