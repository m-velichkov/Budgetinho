/** Add, rename, reorder, archive and delete groups and categories. */

import { useState } from 'react';
import {
  addCategory,
  addGroup,
  deleteCategory,
  deleteGroup,
  moveCategory,
  notify,
  renameGroup,
  updateCategory,
} from '../store/store';
import { useApp } from '../store/hooks';
import { validateName, ValidationError } from '../data/validation';
import { ConfirmDialog, Modal, Switch } from './ui';
import type { Category, CategoryGroup } from '../data/schema';

export function CategoryManager() {
  const { data } = useApp();
  const [newGroupName, setNewGroupName] = useState('');
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [editing, setEditing] = useState<Category | null>(null);
  const [editingGroup, setEditingGroup] = useState<CategoryGroup | null>(null);
  const [deletingCategory, setDeletingCategory] = useState<Category | null>(null);
  const [deletingGroup, setDeletingGroup] = useState<CategoryGroup | null>(null);

  const submitName = (raw: string, action: (name: string) => void) => {
    try {
      action(validateName(raw));
      return true;
    } catch (err) {
      notify('error', err instanceof ValidationError ? err.message : 'That name is not valid.');
      return false;
    }
  };

  const transactionCount = (categoryId: string) =>
    data.transactions.filter((t) => t.categoryId === categoryId).length;

  return (
    <>
      {data.groups.map((group) => {
        const members = data.categories
          .filter((c) => c.groupId === group.id)
          .sort((a, b) => a.sortOrder - b.sortOrder);

        return (
          <div className="card" key={group.id} style={{ marginBottom: 12 }}>
            <div className="row-between" style={{ marginBottom: 8 }}>
              <strong className="grow truncate">{group.name}</strong>
              <button type="button" className="btn small ghost" onClick={() => setEditingGroup(group)}>
                Edit
              </button>
            </div>

            {members.length === 0 ? (
              <p className="small muted">No categories in this group yet.</p>
            ) : (
              <div className="list" style={{ marginBottom: 10 }}>
                {members.map((c, index) => (
                  <div className="list-row" key={c.id}>
                    <div className="grow truncate">
                      <div className="truncate">
                        {c.name}
                        {c.archived ? <span className="tiny muted"> · archived</span> : null}
                      </div>
                      <div className="tiny muted">
                        {c.essential ? 'Essential · ' : ''}
                        {c.goal
                          ? c.goal.type === 'per_period'
                            ? 'Goal every period'
                            : 'Goal by date'
                          : 'No goal'}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Move ${c.name} up`}
                      disabled={index === 0}
                      onClick={() => moveCategory(c.id, -1)}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Move ${c.name} down`}
                      disabled={index === members.length - 1}
                      onClick={() => moveCategory(c.id, 1)}
                    >
                      ↓
                    </button>
                    <button type="button" className="btn small ghost" onClick={() => setEditing(c)}>
                      Edit
                    </button>
                  </div>
                ))}
              </div>
            )}

            {addingTo === group.id ? (
              <form
                className="row"
                style={{ gap: 8 }}
                onSubmit={(e) => {
                  e.preventDefault();
                  if (submitName(newCategoryName, (name) => addCategory(group.id, name))) {
                    setNewCategoryName('');
                    setAddingTo(null);
                  }
                }}
              >
                <input
                  className="input grow"
                  autoFocus
                  placeholder="Category name"
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                />
                <button type="submit" className="btn small primary">
                  Add
                </button>
              </form>
            ) : (
              <button type="button" className="btn small" onClick={() => setAddingTo(group.id)}>
                Add category
              </button>
            )}
          </div>
        );
      })}

      <form
        className="card row"
        style={{ gap: 8 }}
        onSubmit={(e) => {
          e.preventDefault();
          if (submitName(newGroupName, addGroup)) setNewGroupName('');
        }}
      >
        <input
          className="input grow"
          placeholder="New group name"
          value={newGroupName}
          onChange={(e) => setNewGroupName(e.target.value)}
        />
        <button type="submit" className="btn small">
          Add group
        </button>
      </form>

      {editing ? (
        <Modal title="Edit category" onClose={() => setEditing(null)}>
          <div className="field">
            <span className="field-label">Name</span>
            <input
              className="input"
              value={editing.name}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              onBlur={(e) => submitName(e.target.value, (name) => updateCategory(editing.id, { name }))}
            />
          </div>

          <div className="field">
            <span className="field-label">Group</span>
            <select
              className="select"
              value={editing.groupId}
              onChange={(e) => {
                setEditing({ ...editing, groupId: e.target.value });
                updateCategory(editing.id, { groupId: e.target.value });
              }}
            >
              {data.groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>

          <Switch
            label="Essential / upcoming"
            hint="Counts against safe-to-spend."
            checked={editing.essential}
            onChange={(essential) => {
              setEditing({ ...editing, essential });
              updateCategory(editing.id, { essential });
            }}
          />

          <Switch
            label="Archived"
            hint="Hidden from the dashboard, kept in reports."
            checked={Boolean(editing.archived)}
            onChange={(archived) => {
              setEditing({ ...editing, archived });
              updateCategory(editing.id, { archived: archived || undefined });
            }}
          />

          <div className="divider" />
          <button
            type="button"
            className="btn danger block"
            onClick={() => {
              setDeletingCategory(editing);
              setEditing(null);
            }}
          >
            Delete category
          </button>
          <p className="tiny muted">
            Archiving is usually better: it keeps history intact and just hides the card.
          </p>
        </Modal>
      ) : null}

      {editingGroup ? (
        <Modal title="Edit group" onClose={() => setEditingGroup(null)}>
          <div className="field">
            <span className="field-label">Name</span>
            <input
              className="input"
              value={editingGroup.name}
              onChange={(e) => setEditingGroup({ ...editingGroup, name: e.target.value })}
              onBlur={(e) => submitName(e.target.value, (name) => renameGroup(editingGroup.id, name))}
            />
          </div>
          <div className="divider" />
          <button
            type="button"
            className="btn danger block"
            onClick={() => {
              setDeletingGroup(editingGroup);
              setEditingGroup(null);
            }}
          >
            Delete group and its categories
          </button>
        </Modal>
      ) : null}

      {deletingCategory ? (
        <ConfirmDialog
          title={`Delete "${deletingCategory.name}"?`}
          body={
            <>
              {transactionCount(deletingCategory.id) > 0
                ? `${transactionCount(deletingCategory.id)} transaction(s) will stay in your history but become uncategorised. `
                : ''}
              Assignments for this category are removed. This cannot be undone.
            </>
          }
          onCancel={() => setDeletingCategory(null)}
          onConfirm={() => {
            deleteCategory(deletingCategory.id);
            setDeletingCategory(null);
            notify('success', 'Category deleted.');
          }}
        />
      ) : null}

      {deletingGroup ? (
        <ConfirmDialog
          title={`Delete "${deletingGroup.name}"?`}
          body={`Every category in this group is deleted too. Their transactions stay in your history but become uncategorised.`}
          onCancel={() => setDeletingGroup(null)}
          onConfirm={() => {
            deleteGroup(deletingGroup.id);
            setDeletingGroup(null);
            notify('success', 'Group deleted.');
          }}
        />
      ) : null}
    </>
  );
}
