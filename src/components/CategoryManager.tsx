/**
 * Add, rename, reorder, archive and delete groups and categories.
 *
 * Edits are drafts until Save: nothing here commits on keystroke or on blur.
 */

import { useEffect, useState } from 'react';
import {
  addCategory,
  addGroup,
  deleteCategory,
  deleteGroup,
  moveCategory,
  renameGroup,
  updateCategory,
} from '../store/store';
import { useApp } from '../store/hooks';
import { MAX_NAME_LENGTH } from '../data/validation';
import { ConfirmDialog, Modal, Switch } from './ui';
import type { Category, CategoryGroup } from '../data/schema';

/** Returns an error message, or undefined when the name is usable. */
function nameError(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return 'Name is required.';
  if (trimmed.length > MAX_NAME_LENGTH) return `Keep it under ${MAX_NAME_LENGTH} characters.`;
  return undefined;
}

export function CategoryManager() {
  const { data } = useApp();
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupError, setNewGroupError] = useState<string | undefined>();
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategoryError, setNewCategoryError] = useState<string | undefined>();
  const [editing, setEditing] = useState<Category | null>(null);
  const [editingGroup, setEditingGroup] = useState<CategoryGroup | null>(null);
  const [deletingCategory, setDeletingCategory] = useState<Category | null>(null);
  const [deletingGroup, setDeletingGroup] = useState<CategoryGroup | null>(null);

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
                onSubmit={(e) => {
                  e.preventDefault();
                  const err = nameError(newCategoryName);
                  if (err) {
                    setNewCategoryError(err);
                    return;
                  }
                  addCategory(group.id, newCategoryName.trim());
                  setNewCategoryName('');
                  setNewCategoryError(undefined);
                  setAddingTo(null);
                }}
              >
                <div className="row" style={{ gap: 8 }}>
                  <input
                    className={`input grow ${newCategoryError ? 'invalid' : ''}`}
                    autoFocus
                    placeholder="Category name"
                    value={newCategoryName}
                    onChange={(e) => {
                      setNewCategoryName(e.target.value);
                      setNewCategoryError(undefined);
                    }}
                  />
                  <button type="submit" className="btn small primary">
                    Save
                  </button>
                </div>
                {newCategoryError ? (
                  <span className="field-error" role="alert">
                    {newCategoryError}
                  </span>
                ) : null}
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
        className="card"
        onSubmit={(e) => {
          e.preventDefault();
          const err = nameError(newGroupName);
          if (err) {
            setNewGroupError(err);
            return;
          }
          addGroup(newGroupName.trim());
          setNewGroupName('');
          setNewGroupError(undefined);
        }}
      >
        <div className="row" style={{ gap: 8 }}>
          <input
            className={`input grow ${newGroupError ? 'invalid' : ''}`}
            placeholder="New group name"
            value={newGroupName}
            onChange={(e) => {
              setNewGroupName(e.target.value);
              setNewGroupError(undefined);
            }}
          />
          <button type="submit" className="btn small">
            Add group
          </button>
        </div>
        {newGroupError ? (
          <span className="field-error" role="alert">
            {newGroupError}
          </span>
        ) : null}
      </form>

      {editing ? (
        <EditCategoryDialog
          category={editing}
          groups={data.groups}
          onClose={() => setEditing(null)}
          onDelete={() => {
            setDeletingCategory(editing);
            setEditing(null);
          }}
        />
      ) : null}

      {editingGroup ? (
        <EditGroupDialog
          group={editingGroup}
          onClose={() => setEditingGroup(null)}
          onDelete={() => {
            setDeletingGroup(editingGroup);
            setEditingGroup(null);
          }}
        />
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
          }}
        />
      ) : null}

      {deletingGroup ? (
        <ConfirmDialog
          title={`Delete "${deletingGroup.name}"?`}
          body="Every category in this group is deleted too. Their transactions stay in your history but become uncategorised."
          onCancel={() => setDeletingGroup(null)}
          onConfirm={() => {
            deleteGroup(deletingGroup.id);
            setDeletingGroup(null);
          }}
        />
      ) : null}
    </>
  );
}

/** Draft editor for one category. Commits only on Save. */
function EditCategoryDialog({
  category,
  groups,
  onClose,
  onDelete,
}: {
  category: Category;
  groups: CategoryGroup[];
  onClose: () => void;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState({
    name: category.name,
    groupId: category.groupId,
    archived: Boolean(category.archived),
  });
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    setDraft({ name: category.name, groupId: category.groupId, archived: Boolean(category.archived) });
  }, [category.id, category.name, category.groupId, category.archived]);

  const dirty =
    draft.name !== category.name ||
    draft.groupId !== category.groupId ||
    draft.archived !== Boolean(category.archived);

  const save = () => {
    const err = nameError(draft.name);
    if (err) {
      setError(err);
      return;
    }
    updateCategory(category.id, {
      name: draft.name.trim(),
      groupId: draft.groupId,
      archived: draft.archived || undefined,
    });
    onClose();
  };

  return (
    <Modal title="Edit category" onClose={onClose}>
      <div className="field">
        <span className="field-label">Name</span>
        <input
          className={`input ${error ? 'invalid' : ''}`}
          value={draft.name}
          onChange={(e) => {
            setDraft({ ...draft, name: e.target.value });
            setError(undefined);
          }}
        />
        {error ? (
          <span className="field-error" role="alert">
            {error}
          </span>
        ) : null}
      </div>

      <div className="field">
        <span className="field-label">Group</span>
        <select
          className="select"
          value={draft.groupId}
          onChange={(e) => setDraft({ ...draft, groupId: e.target.value })}
        >
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      </div>

      <Switch
        label="Archived"
        hint="Hidden from the dashboard, kept in reports."
        checked={draft.archived}
        onChange={(archived) => setDraft({ ...draft, archived })}
      />

      <div className="row" style={{ gap: 8, marginTop: 14 }}>
        <button type="button" className="btn grow" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn primary grow" disabled={!dirty} onClick={save}>
          Save
        </button>
      </div>

      <div className="divider" />
      <button type="button" className="btn danger block" onClick={onDelete}>
        Delete category
      </button>
      <p className="tiny muted">
        Archiving is usually better: it keeps history intact and just hides the card.
      </p>
    </Modal>
  );
}

/** Draft editor for one group. Commits only on Save. */
function EditGroupDialog({
  group,
  onClose,
  onDelete,
}: {
  group: CategoryGroup;
  onClose: () => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(group.name);
  const [error, setError] = useState<string | undefined>();
  const dirty = name !== group.name;

  return (
    <Modal title="Edit group" onClose={onClose}>
      <div className="field">
        <span className="field-label">Name</span>
        <input
          className={`input ${error ? 'invalid' : ''}`}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setError(undefined);
          }}
        />
        {error ? (
          <span className="field-error" role="alert">
            {error}
          </span>
        ) : null}
      </div>

      <div className="row" style={{ gap: 8 }}>
        <button type="button" className="btn grow" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="btn primary grow"
          disabled={!dirty}
          onClick={() => {
            const err = nameError(name);
            if (err) {
              setError(err);
              return;
            }
            renameGroup(group.id, name.trim());
            onClose();
          }}
        >
          Save
        </button>
      </div>

      <div className="divider" />
      <button type="button" className="btn danger block" onClick={onDelete}>
        Delete group and its categories
      </button>
    </Modal>
  );
}
