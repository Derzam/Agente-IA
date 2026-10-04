import React, { useEffect, useState } from 'react';
import {
  Plus,
  Edit2,
  Trash2,
  CheckCircle2,
  XCircle,
  ShoppingBag,
  Layers,
  ArrowUp,
  ArrowDown,
} from 'lucide-react';
import { Button } from '@/components/common/Button';
import { Switch } from '@/components/common/Switch';
import { Modal } from '@/components/common/Modal';
import { FilterBar } from '@/components/common/FilterBar';
import { EmptyState } from '@/components/common/EmptyState';
import { VersionConflictNotice } from '@/components/common/VersionConflictNotice';
import { ApiErrorBanner } from '@/components/common/ApiErrorBanner';
import { menuService } from '@/services/menuService';
import {
  MenuItem,
  MenuItemCategory,
  ModifierGroup,
  ModifierOption,
} from '@/types/viewModels';
import { decimalToMinor } from '@/adapters/moneyAdapter';
import { VersionConflictError } from '@/api/types';
import { USE_MOCK_DATA } from '@/services/apiClient';

export const MenuView: React.FC = () => {
  const [categories, setCategories] = useState<MenuItemCategory[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedStockFilter, setSelectedStockFilter] = useState<'all' | 'in_stock' | 'out_of_stock'>('all');
  const [isLoading, setIsLoading] = useState(true);
  const [conflictError, setConflictError] = useState<string | null>(null);
  const [apiError, setApiError] = useState<Error | null>(null);

  // Product Modal State
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [productTab, setProductTab] = useState<'info' | 'modifiers'>('info');

  // Product Delete State
  const [itemToDelete, setItemToDelete] = useState<MenuItem | null>(null);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);

  // Category Manager State
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategorySort, setNewCategorySort] = useState(1);
  const [newCategoryActive, setNewCategoryActive] = useState(true);
  const [editingCategory, setEditingCategory] = useState<MenuItemCategory | null>(null);

  // Group Modal State (inside Product)
  const [editingGroup, setEditingGroup] = useState<ModifierGroup | null>(null);
  const [isGroupModalOpen, setIsGroupModalOpen] = useState(false);
  const [isNewGroup, setIsNewGroup] = useState(false);

  // Option Modal State (inside Group)
  const [targetGroupId, setTargetGroupId] = useState<string | null>(null);
  const [editingOption, setEditingOption] = useState<ModifierOption | null>(null);
  const [isOptionModalOpen, setIsOptionModalOpen] = useState(false);
  const [isNewOption, setIsNewOption] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setIsLoading(true);
    setConflictError(null);
    setApiError(null);
    try {
      const [cats, menuItems] = await Promise.all([
        menuService.getCategories(),
        menuService.getMenuItems(),
      ]);
      setCategories(cats);
      setItems(menuItems);
    } catch (err: any) {
      if (err instanceof VersionConflictError) {
        setConflictError(err.message);
      } else {
        setApiError(err);
      }
    } finally {
      setIsLoading(false);
    }
  };

  // ==========================================
  // PRODUCT ACTIONS
  // ==========================================
  const handleToggleStock = async (itemId: string, currentVal: boolean) => {
    const target = items.find((i) => i.id === itemId);
    setConflictError(null);
    setApiError(null);
    try {
      const updated = await menuService.toggleAvailability(itemId, !currentVal, target?.version || 1);
      setItems((prev) => prev.map((item) => (item.id === itemId ? updated : item)));
    } catch (err: any) {
      if (err instanceof VersionConflictError) {
        setConflictError(err.message);
        await loadData();
      } else {
        setApiError(err);
      }
    }
  };

  const handleSaveItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingItem) return;

    setConflictError(null);
    setApiError(null);

    try {
      const isNew = !items.some((i) => i.id === editingItem.id);
      let saved: MenuItem;

      if (isNew) {
        saved = await menuService.createItem({
          categoryId: editingItem.categoryId,
          categoryName: categories.find((c) => c.id === editingItem.categoryId)?.name,
          name: editingItem.name,
          description: editingItem.description,
          price: editingItem.price,
          priceMinor: decimalToMinor(editingItem.price),
          imageUrl: editingItem.imageUrl,
          isAvailable: editingItem.isAvailable,
          modifierGroups: editingItem.modifierGroups || [],
        });
        setItems((prev) => [saved, ...prev]);
      } else {
        saved = await menuService.updateItem({
          ...editingItem,
          priceMinor: decimalToMinor(editingItem.price),
        });
        setItems((prev) => prev.map((i) => (i.id === saved.id ? saved : i)));
      }

      setIsModalOpen(false);
      setEditingItem(null);
    } catch (err: any) {
      if (err instanceof VersionConflictError) {
        setConflictError(err.message);
        await loadData();
      } else {
        setApiError(err);
      }
    }
  };

  const handleDeleteItem = async () => {
    if (!itemToDelete) return;
    setConflictError(null);
    setApiError(null);
    try {
      await menuService.deleteItem(itemToDelete.id, itemToDelete.version || 1);
      setItems((prev) => prev.filter((i) => i.id !== itemToDelete.id));
      setIsDeleteModalOpen(false);
      setItemToDelete(null);
    } catch (err: any) {
      if (err instanceof VersionConflictError) {
        setConflictError(err.message);
        await loadData();
      } else {
        setApiError(err);
      }
    }
  };

  const handleOpenNewModal = () => {
    setEditingItem({
      id: `item-${Date.now()}`,
      categoryId: categories[0]?.id || 'cat-1',
      name: '',
      description: '',
      price: 0,
      priceMinor: 0,
      isAvailable: true,
      imageUrl: '',
      modifierGroups: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    setProductTab('info');
    setIsModalOpen(true);
  };

  // ==========================================
  // HIERARCHICAL MODIFIERS MANAGEMENT (LOCAL TO EDITING ITEM)
  // ==========================================
  const handleOpenNewGroup = () => {
    const currentGroups = editingItem?.modifierGroups || [];
    setEditingGroup({
      id: `grp-${Date.now()}`,
      name: '',
      required: false,
      minSelect: 0,
      maxSelect: 1,
      minSelections: 0,
      maxSelections: 1,
      sortOrder: currentGroups.length + 1,
      active: true,
      version: 1,
      options: [],
    });
    setIsNewGroup(true);
    setIsGroupModalOpen(true);
  };

  const handleSaveGroup = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingItem || !editingGroup) return;

    const currentGroups = editingItem.modifierGroups ? [...editingItem.modifierGroups] : [];
    const groupWithSelections: ModifierGroup = {
      ...editingGroup,
      minSelections: editingGroup.minSelect,
      maxSelections: editingGroup.maxSelect,
    };

    if (isNewGroup) {
      currentGroups.push(groupWithSelections);
    } else {
      const idx = currentGroups.findIndex((g) => g.id === editingGroup.id);
      if (idx !== -1) {
        currentGroups[idx] = groupWithSelections;
      }
    }

    setEditingItem({
      ...editingItem,
      modifierGroups: currentGroups,
    });
    setIsGroupModalOpen(false);
    setEditingGroup(null);
  };

  const handleDeleteGroup = (groupId: string) => {
    if (!editingItem) return;
    setEditingItem({
      ...editingItem,
      modifierGroups: (editingItem.modifierGroups || []).filter((g) => g.id !== groupId),
    });
  };

  const handleToggleGroupActive = (groupId: string, active: boolean) => {
    if (!editingItem) return;
    setEditingItem({
      ...editingItem,
      modifierGroups: (editingItem.modifierGroups || []).map((g) =>
        g.id === groupId ? { ...g, active } : g
      ),
    });
  };

  const handleReorderGroup = (groupId: string, direction: 'up' | 'down') => {
    if (!editingItem || !editingItem.modifierGroups) return;
    const groups = [...editingItem.modifierGroups];
    const index = groups.findIndex((g) => g.id === groupId);
    if (index === -1) return;

    if (direction === 'up' && index > 0) {
      const temp = groups[index];
      groups[index] = groups[index - 1];
      groups[index - 1] = temp;
    } else if (direction === 'down' && index < groups.length - 1) {
      const temp = groups[index];
      groups[index] = groups[index + 1];
      groups[index + 1] = temp;
    }

    // Refresh sortOrder
    groups.forEach((g, i) => {
      g.sortOrder = i + 1;
    });

    setEditingItem({
      ...editingItem,
      modifierGroups: groups,
    });
  };

  // Option actions
  const handleOpenNewOption = (groupId: string) => {
    setTargetGroupId(groupId);
    const group = (editingItem?.modifierGroups || []).find((g) => g.id === groupId);
    const existingOptions = group?.options || [];

    setEditingOption({
      id: `opt-${Date.now()}`,
      name: '',
      priceDelta: 0,
      priceDeltaMinor: 0,
      isAvailable: true,
      sortOrder: existingOptions.length + 1,
      version: 1,
    });
    setIsNewOption(true);
    setIsOptionModalOpen(true);
  };

  const handleSaveOption = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingItem || !editingOption || !targetGroupId) return;

    const groups = [...(editingItem.modifierGroups || [])];
    const groupIndex = groups.findIndex((g) => g.id === targetGroupId);
    if (groupIndex === -1) return;

    const group = { ...groups[groupIndex] };
    const options = [...group.options];

    const finalizedOption: ModifierOption = {
      ...editingOption,
      priceDeltaMinor: decimalToMinor(editingOption.priceDelta),
    };

    if (isNewOption) {
      options.push(finalizedOption);
    } else {
      const optIdx = options.findIndex((o) => o.id === editingOption.id);
      if (optIdx !== -1) {
        options[optIdx] = finalizedOption;
      }
    }

    group.options = options;
    groups[groupIndex] = group;

    setEditingItem({
      ...editingItem,
      modifierGroups: groups,
    });
    setIsOptionModalOpen(false);
    setEditingOption(null);
    setTargetGroupId(null);
  };

  const handleDeleteOption = (groupId: string, optionId: string) => {
    if (!editingItem) return;
    const groups = (editingItem.modifierGroups || []).map((g) => {
      if (g.id !== groupId) return g;
      return {
        ...g,
        options: g.options.filter((o) => o.id !== optionId),
      };
    });
    setEditingItem({ ...editingItem, modifierGroups: groups });
  };

  const handleToggleOptionAvailable = (groupId: string, optionId: string, isAvailable: boolean) => {
    if (!editingItem) return;
    const groups = (editingItem.modifierGroups || []).map((g) => {
      if (g.id !== groupId) return g;
      return {
        ...g,
        options: g.options.map((o) => (o.id === optionId ? { ...o, isAvailable } : o)),
      };
    });
    setEditingItem({ ...editingItem, modifierGroups: groups });
  };

  // ==========================================
  // CATEGORIES MANAGEMENT
  // ==========================================
  const handleCreateCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCategoryName.trim()) return;
    setConflictError(null);
    setApiError(null);

    try {
      const created = await menuService.createCategory({
        name: newCategoryName.trim(),
        sortOrder: newCategorySort,
        isActive: newCategoryActive,
      });
      setCategories((prev) => [...prev, created].sort((a, b) => a.sortOrder - b.sortOrder));
      setNewCategoryName('');
      setNewCategorySort(categories.length + 2);
    } catch (err: any) {
      if (err instanceof VersionConflictError) {
        setConflictError(err.message);
        await loadData();
      } else {
        setApiError(err);
      }
    }
  };

  const handleUpdateCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCategory) return;
    setConflictError(null);
    setApiError(null);

    try {
      const updated = await menuService.updateCategory(editingCategory);
      setCategories((prev) =>
        prev.map((c) => (c.id === updated.id ? updated : c)).sort((a, b) => a.sortOrder - b.sortOrder)
      );
      setEditingCategory(null);
    } catch (err: any) {
      if (err instanceof VersionConflictError) {
        setConflictError(err.message);
        await loadData();
      } else {
        setApiError(err);
      }
    }
  };

  const handleToggleCategoryActive = async (cat: MenuItemCategory) => {
    setConflictError(null);
    setApiError(null);
    try {
      const updated = await menuService.toggleCategoryActive(cat.id, !cat.isActive, cat.version || 1);
      setCategories((prev) =>
        prev.map((c) => (c.id === cat.id ? updated : c)).sort((a, b) => a.sortOrder - b.sortOrder)
      );
    } catch (err: any) {
      if (err instanceof VersionConflictError) {
        setConflictError(err.message);
        await loadData();
      } else {
        setApiError(err);
      }
    }
  };

  const handleDeleteCategory = async (cat: MenuItemCategory) => {
    setConflictError(null);
    setApiError(null);
    try {
      await menuService.deleteCategory(cat.id, cat.version || 1);
      setCategories((prev) => prev.filter((c) => c.id !== cat.id));
    } catch (err: any) {
      if (err instanceof VersionConflictError) {
        setConflictError(err.message);
        await loadData();
      } else {
        setApiError(err);
      }
    }
  };

  // Filter items
  const filteredItems = items.filter((item) => {
    const matchesSearch =
      item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.description.toLowerCase().includes(searchQuery.toLowerCase());
    if (!matchesSearch) return false;

    if (selectedCategoryId !== 'all' && item.categoryId !== selectedCategoryId) return false;
    if (selectedStockFilter === 'in_stock' && !item.isAvailable) return false;
    if (selectedStockFilter === 'out_of_stock' && item.isAvailable) return false;

    return true;
  });

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-7xl mx-auto">
      {/* Conflict Notice */}
      {conflictError && (
        <VersionConflictNotice
          message={conflictError}
          onRefresh={loadData}
        />
      )}

      {/* API Error Banner */}
      {apiError && (
        <ApiErrorBanner
          error={apiError}
          onRetry={loadData}
        />
      )}

      {/* Category Pills & Top Actions */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
        <div className="flex gap-1.5 overflow-x-auto pb-1 sm:pb-0">
          <button
            onClick={() => setSelectedCategoryId('all')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap ${
              selectedCategoryId === 'all'
                ? 'bg-orange-600 text-white shadow-xs'
                : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
            }`}
          >
            Todas las Categorías ({items.length})
          </button>
          {categories.map((cat) => {
            const count = items.filter((i) => i.categoryId === cat.id).length;
            const isSelected = selectedCategoryId === cat.id;
            return (
              <button
                key={cat.id}
                onClick={() => setSelectedCategoryId(cat.id)}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap flex items-center gap-1.5 ${
                  isSelected
                    ? 'bg-orange-600 text-white shadow-xs'
                    : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
                }`}
              >
                <span>{cat.name} ({count})</span>
                {!cat.isActive && (
                  <span className="w-2 h-2 rounded-full bg-rose-400" title="Categoría Inactiva" />
                )}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsCategoryModalOpen(true)}
            leftIcon={<Layers className="w-4 h-4 text-slate-600" />}
          >
            Categorías
          </Button>

          <Button
            variant="primary"
            size="sm"
            onClick={handleOpenNewModal}
            leftIcon={<Plus className="w-4 h-4" />}
          >
            Nuevo Producto
          </Button>
        </div>
      </div>

      {/* Filter Bar */}
      <FilterBar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        searchPlaceholder="Buscar plato por nombre o descripción..."
        filters={[
          { id: 'all', label: 'Todos', active: selectedStockFilter === 'all', onClick: () => setSelectedStockFilter('all') },
          { id: 'in_stock', label: 'Disponibles', active: selectedStockFilter === 'in_stock', count: items.filter((i) => i.isAvailable).length, onClick: () => setSelectedStockFilter('in_stock') },
          { id: 'out_of_stock', label: 'Agotados', active: selectedStockFilter === 'out_of_stock', count: items.filter((i) => !i.isAvailable).length, onClick: () => setSelectedStockFilter('out_of_stock') },
        ]}
      />

      {/* Products Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-64 bg-white rounded-2xl border border-slate-200 animate-pulse" />
          ))}
        </div>
      ) : filteredItems.length === 0 ? (
        <EmptyState
          icon={<ShoppingBag className="w-8 h-8 text-slate-400" />}
          title="No hay productos en esta vista"
          description="Intente con otro término de búsqueda o seleccione otra categoría."
          action={
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setSearchQuery('');
                setSelectedCategoryId('all');
                setSelectedStockFilter('all');
              }}
            >
              Ver todo el menú
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredItems.map((item) => (
            <div
              key={item.id}
              className={`bg-white rounded-2xl border transition-all duration-200 shadow-2xs hover:shadow-md overflow-hidden flex flex-col justify-between ${
                item.isAvailable ? 'border-slate-200' : 'border-rose-200 bg-rose-50/20'
              }`}
            >
              {/* Product Image & Stock Badge */}
              <div className="relative h-44 bg-slate-100 overflow-hidden">
                {item.imageUrl ? (
                  <img
                    src={item.imageUrl}
                    alt={item.name}
                    className={`w-full h-full object-cover transition-transform duration-300 hover:scale-105 ${
                      !item.isAvailable ? 'grayscale opacity-75' : ''
                    }`}
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-slate-400 text-xs font-medium">
                    Sin foto referencial
                  </div>
                )}

                {/* Instant Stock Badge overlay */}
                <div className="absolute top-3 left-3">
                  {item.isAvailable ? (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-white/95 text-emerald-700 shadow-sm backdrop-blur-xs">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                      Disponible
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-rose-600 text-white shadow-sm">
                      <XCircle className="w-3.5 h-3.5 text-white" />
                      Agotado
                    </span>
                  )}
                </div>

                <div className="absolute top-3 right-3">
                  <span className="px-2.5 py-1 rounded-lg text-sm font-black bg-slate-900/80 text-white backdrop-blur-xs shadow-sm">
                    ${item.price.toFixed(2)}
                  </span>
                </div>
              </div>

              {/* Product Info */}
              <div className="p-4 sm:p-5 flex-1 flex flex-col justify-between space-y-3">
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <h4 className="font-bold text-slate-900 text-base">{item.name}</h4>
                    {item.modifierGroups && item.modifierGroups.length > 0 && (
                      <span className="text-[10px] font-semibold bg-orange-100 text-orange-800 px-2 py-0.5 rounded-full shrink-0">
                        {item.modifierGroups.length} {item.modifierGroups.length === 1 ? 'grupo' : 'grupos'}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 mt-1 line-clamp-2 leading-relaxed">
                    {item.description || 'Sin descripción'}
                  </p>
                </div>

                {/* Instant Toggle Control & Edit Buttons */}
                <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={item.isAvailable}
                      onChange={() => handleToggleStock(item.id, item.isAvailable)}
                      size="sm"
                    />
                    <span className="text-xs font-semibold text-slate-700">
                      {item.isAvailable ? 'En stock' : 'Pausar stock'}
                    </span>
                  </div>

                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setEditingItem({ ...item });
                        setProductTab('info');
                        setIsModalOpen(true);
                      }}
                      leftIcon={<Edit2 className="w-3.5 h-3.5 text-slate-500" />}
                    >
                      Editar
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setItemToDelete(item);
                        setIsDeleteModalOpen(true);
                      }}
                      className="text-rose-600 hover:text-rose-700 hover:bg-rose-50"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ========================================== */}
      {/* CREATE / EDIT PRODUCT MODAL                */}
      {/* ========================================== */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={editingItem?.name ? `Editar "${editingItem.name}"` : 'Crear Nuevo Producto'}
        maxWidth="2xl"
        footer={
          <div className="flex justify-between items-center w-full">
            <span className="text-xs text-slate-400">
              Versión: {editingItem?.version ?? 1}
            </span>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => setIsModalOpen(false)}>
                Cancelar
              </Button>
              <Button variant="primary" size="sm" onClick={handleSaveItem}>
                Guardar Producto
              </Button>
            </div>
          </div>
        }
      >
        {editingItem && (
          <div className="space-y-4">
            {/* Tabs for Info vs Modifiers */}
            <div className="flex border-b border-slate-200">
              <button
                type="button"
                onClick={() => setProductTab('info')}
                className={`py-2 px-4 text-xs font-bold border-b-2 transition-all ${
                  productTab === 'info'
                    ? 'border-orange-600 text-orange-600'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                Información Básica
              </button>
              <button
                type="button"
                onClick={() => setProductTab('modifiers')}
                className={`py-2 px-4 text-xs font-bold border-b-2 transition-all flex items-center gap-1.5 ${
                  productTab === 'modifiers'
                    ? 'border-orange-600 text-orange-600'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                <span>Grupos de Modificadores</span>
                <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-slate-100 font-bold">
                  {editingItem.modifierGroups?.length || 0}
                </span>
              </button>
            </div>

            {productTab === 'info' ? (
              <form onSubmit={handleSaveItem} className="space-y-4 text-xs sm:text-sm">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Nombre del Plato / Producto:</label>
                  <input
                    type="text"
                    value={editingItem.name}
                    onChange={(e) => setEditingItem({ ...editingItem, name: e.target.value })}
                    placeholder="ej. Hamburguesa Especial con Papas"
                    required
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-orange-500 focus:outline-none"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Categoría:</label>
                    <select
                      value={editingItem.categoryId}
                      onChange={(e) => setEditingItem({ ...editingItem, categoryId: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-orange-500 focus:outline-none"
                    >
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name} {!c.isActive ? '(Inactiva)' : ''}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Precio Base ($ USD):</label>
                    <input
                      type="number"
                      step="0.05"
                      min="0"
                      value={editingItem.price}
                      onChange={(e) =>
                        setEditingItem({
                          ...editingItem,
                          price: parseFloat(e.target.value) || 0,
                          priceMinor: decimalToMinor(parseFloat(e.target.value) || 0),
                        })
                      }
                      required
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-orange-500 focus:outline-none"
                    />
                    <p className="text-[10px] text-slate-400 mt-0.5">
                      Base: ${(editingItem.price || 0).toFixed(2)} ({decimalToMinor(editingItem.price || 0)} minor units). Los modificadores se cobran por separado.
                    </p>
                  </div>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Descripción del Producto (utilizada por el Agente):
                  </label>
                  <textarea
                    rows={3}
                    value={editingItem.description}
                    onChange={(e) => setEditingItem({ ...editingItem, description: e.target.value })}
                    placeholder="Describe los ingredientes, opciones y características..."
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-orange-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">URL de Imagen referencial:</label>
                  <input
                    type="url"
                    value={editingItem.imageUrl || ''}
                    onChange={(e) => setEditingItem({ ...editingItem, imageUrl: e.target.value })}
                    placeholder="https://images.unsplash.com/..."
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-orange-500 focus:outline-none"
                  />
                </div>

                <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
                  <Switch
                    checked={editingItem.isAvailable}
                    onChange={(checked) => setEditingItem({ ...editingItem, isAvailable: checked })}
                    label="Disponible para ordenar inmediatamente"
                    description="Si se desmarca, el bot comunicará que está agotado y sugerirá sustitutos."
                  />
                </div>
              </form>
            ) : (
              /* MODIFIERS TAB */
              <div className="space-y-4">
                <div className="flex justify-between items-center bg-slate-50 p-3 rounded-xl border border-slate-200">
                  <div>
                    <h5 className="font-bold text-slate-800 text-xs">Grupos de Modificadores del Plato</h5>
                    <p className="text-[11px] text-slate-500">
                      Configure grupos obligatorios (ej. Tamaño) u opcionales (ej. Extras) con selección min/max.
                    </p>
                  </div>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={handleOpenNewGroup}
                    leftIcon={<Plus className="w-3.5 h-3.5" />}
                  >
                    Agregar Grupo
                  </Button>
                </div>

                {(!editingItem.modifierGroups || editingItem.modifierGroups.length === 0) ? (
                  <div className="text-center py-8 border-2 border-dashed border-slate-200 rounded-xl text-slate-400 text-xs">
                    <p className="font-semibold">Sin grupos de modificadores</p>
                    <p className="mt-1">Agregue grupos como &quot;Tamaño&quot;, &quot;Extras&quot; o &quot;Tipo de carne&quot;.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {editingItem.modifierGroups.map((group, groupIdx) => (
                      <div
                        key={group.id}
                        className={`border rounded-xl p-3.5 space-y-3 ${
                          group.active ? 'border-slate-200 bg-white' : 'border-slate-200 bg-slate-50/70 opacity-75'
                        }`}
                      >
                        {/* Group Header */}
                        <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-slate-900">{group.name}</span>
                            <span
                              className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                group.required
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : 'bg-slate-100 text-slate-700'
                              }`}
                            >
                              {group.required ? 'Obligatorio' : 'Opcional'}
                            </span>
                            <span className="text-[10px] text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
                              Min: {group.minSelect} / Max: {group.maxSelect}
                            </span>
                            <span className="text-[10px] text-slate-400">
                              Orden: {group.sortOrder}
                            </span>
                          </div>

                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => handleReorderGroup(group.id, 'up')}
                              disabled={!USE_MOCK_DATA || groupIdx === 0}
                              className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-30"
                              title={USE_MOCK_DATA ? 'Subir' : 'Orden de grupos pendiente del contrato jerárquico del backend'}
                            >
                              <ArrowUp className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleReorderGroup(group.id, 'down')}
                              disabled={!USE_MOCK_DATA || groupIdx === (editingItem.modifierGroups?.length || 1) - 1}
                              className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-30"
                              title={USE_MOCK_DATA ? 'Bajar' : 'Orden de grupos pendiente del contrato jerárquico del backend'}
                            >
                              <ArrowDown className="w-3.5 h-3.5" />
                            </button>

                            <Switch
                              checked={group.active}
                              onChange={(act) => handleToggleGroupActive(group.id, act)}
                              disabled={!USE_MOCK_DATA}
                              size="sm"
                            />

                            <button
                              type="button"
                              onClick={() => {
                                setEditingGroup({ ...group });
                                setIsNewGroup(false);
                                setIsGroupModalOpen(true);
                              }}
                              className="p-1 text-slate-500 hover:text-slate-800"
                              title="Editar Grupo"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>

                            <button
                              type="button"
                              onClick={() => handleDeleteGroup(group.id)}
                              className="p-1 text-rose-500 hover:text-rose-700"
                              title="Eliminar Grupo"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        {/* Options List */}
                        <div className="space-y-2">
                          <div className="flex justify-between items-center">
                            <span className="text-[11px] font-bold text-slate-600 uppercase tracking-wide">
                              Opciones ({group.options.length})
                            </span>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleOpenNewOption(group.id)}
                              leftIcon={<Plus className="w-3 h-3" />}
                              className="text-xs text-orange-600"
                            >
                              Agregar Opción
                            </Button>
                          </div>

                          {group.options.length === 0 ? (
                            <p className="text-xs text-slate-400 italic py-2">
                              No hay opciones agregadas a este grupo todavía.
                            </p>
                          ) : (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              {group.options.map((opt) => (
                                <div
                                  key={opt.id}
                                  className="flex items-center justify-between p-2 rounded-lg border border-slate-200 bg-slate-50 text-xs"
                                >
                                  <div>
                                    <span className="font-semibold text-slate-800">{opt.name}</span>
                                    <span className="ml-1.5 font-bold text-emerald-700">
                                      {opt.priceDelta > 0
                                        ? `+$${opt.priceDelta.toFixed(2)}`
                                        : '+$0.00'}
                                    </span>
                                  </div>

                                  <div className="flex items-center gap-1.5">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        handleToggleOptionAvailable(group.id, opt.id, !opt.isAvailable)
                                      }
                                      className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                                        opt.isAvailable
                                          ? 'bg-emerald-100 text-emerald-800'
                                          : 'bg-rose-100 text-rose-800'
                                      }`}
                                    >
                                      {opt.isAvailable ? 'Disponible' : 'Agotado'}
                                    </button>

                                    <button
                                      type="button"
                                      onClick={() => {
                                        setTargetGroupId(group.id);
                                        setEditingOption({ ...opt });
                                        setIsNewOption(false);
                                        setIsOptionModalOpen(true);
                                      }}
                                      className="p-1 text-slate-400 hover:text-slate-700"
                                      title="Editar"
                                    >
                                      <Edit2 className="w-3 h-3" />
                                    </button>

                                    <button
                                      type="button"
                                      onClick={() => handleDeleteOption(group.id, opt.id)}
                                      className="p-1 text-rose-400 hover:text-rose-600"
                                      title="Eliminar"
                                    >
                                      <Trash2 className="w-3 h-3" />
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* ========================================== */}
      {/* EDIT MODIFIER GROUP MODAL                  */}
      {/* ========================================== */}
      <Modal
        isOpen={isGroupModalOpen}
        onClose={() => setIsGroupModalOpen(false)}
        title={isNewGroup ? 'Nuevo Grupo de Modificadores' : `Editar "${editingGroup?.name}"`}
        maxWidth="md"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setIsGroupModalOpen(false)}>
              Cancelar
            </Button>
            <Button variant="primary" size="sm" onClick={handleSaveGroup}>
              Confirmar Grupo
            </Button>
          </div>
        }
      >
        {editingGroup && (
          <form onSubmit={handleSaveGroup} className="space-y-4 text-xs sm:text-sm">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Nombre del Grupo:</label>
              <input
                type="text"
                value={editingGroup.name}
                onChange={(e) => setEditingGroup({ ...editingGroup, name: e.target.value })}
                placeholder="ej. Tamaño, Extras, Término de la carne..."
                required
                className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-orange-500 focus:outline-none"
              />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Mínimo:</label>
                <input
                  type="number"
                  min="0"
                  value={editingGroup.minSelect}
                  onChange={(e) =>
                    setEditingGroup({ ...editingGroup, minSelect: parseInt(e.target.value, 10) || 0 })
                  }
                  required
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-orange-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Máximo:</label>
                <input
                  type="number"
                  min="1"
                  value={editingGroup.maxSelect}
                  onChange={(e) =>
                    setEditingGroup({ ...editingGroup, maxSelect: parseInt(e.target.value, 10) || 1 })
                  }
                  required
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-orange-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Orden:</label>
                <input
                  type="number"
                  min="1"
                  value={editingGroup.sortOrder}
                  onChange={(e) =>
                    setEditingGroup({ ...editingGroup, sortOrder: parseInt(e.target.value, 10) || 1 })
                  }
                  required
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-orange-500 focus:outline-none"
                />
              </div>
            </div>

            <div className="space-y-2 pt-2 border-t border-slate-100">
              <Switch
                checked={editingGroup.required}
                onChange={(checked) => setEditingGroup({ ...editingGroup, required: checked })}
                label="Selección Obligatoria"
                description="El cliente debe elegir al menos el mínimo especificado."
              />

              <Switch
                checked={editingGroup.active}
                onChange={(checked) => setEditingGroup({ ...editingGroup, active: checked })}
                label="Grupo Activo"
                description="Si se desactiva, no se mostrará a los clientes."
              />
            </div>
          </form>
        )}
      </Modal>

      {/* ========================================== */}
      {/* EDIT MODIFIER OPTION MODAL                 */}
      {/* ========================================== */}
      <Modal
        isOpen={isOptionModalOpen}
        onClose={() => setIsOptionModalOpen(false)}
        title={isNewOption ? 'Nueva Opción de Modificador' : `Editar Opción "${editingOption?.name}"`}
        maxWidth="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setIsOptionModalOpen(false)}>
              Cancelar
            </Button>
            <Button variant="primary" size="sm" onClick={handleSaveOption}>
              Guardar Opción
            </Button>
          </div>
        }
      >
        {editingOption && (
          <form onSubmit={handleSaveOption} className="space-y-4 text-xs sm:text-sm">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Nombre de la Opción:</label>
              <input
                type="text"
                value={editingOption.name}
                onChange={(e) => setEditingOption({ ...editingOption, name: e.target.value })}
                placeholder="ej. Queso Extra, Tocino, Doble..."
                required
                className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-orange-500 focus:outline-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Incremento de Precio ($):</label>
                <input
                  type="number"
                  step="0.05"
                  min="0"
                  value={editingOption.priceDelta}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value) || 0;
                    setEditingOption({
                      ...editingOption,
                      priceDelta: val,
                      priceDeltaMinor: decimalToMinor(val),
                    });
                  }}
                  required
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-orange-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Orden:</label>
                <input
                  type="number"
                  min="1"
                  value={editingOption.sortOrder}
                  onChange={(e) =>
                    setEditingOption({ ...editingOption, sortOrder: parseInt(e.target.value, 10) || 1 })
                  }
                  required
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-orange-500 focus:outline-none"
                />
              </div>
            </div>

            <div className="pt-2 border-t border-slate-100">
              <Switch
                checked={editingOption.isAvailable}
                onChange={(checked) => setEditingOption({ ...editingOption, isAvailable: checked })}
                label="Opción Disponible"
                description="Desmarque si el insumo está agotado temporalmente."
              />
            </div>
          </form>
        )}
      </Modal>

      {/* ========================================== */}
      {/* CATEGORY MANAGEMENT MODAL                  */}
      {/* ========================================== */}
      <Modal
        isOpen={isCategoryModalOpen}
        onClose={() => setIsCategoryModalOpen(false)}
        title="Gestión de Categorías del Catálogo"
        maxWidth="lg"
        footer={
          <Button variant="ghost" size="sm" onClick={() => setIsCategoryModalOpen(false)}>
            Cerrar
          </Button>
        }
      >
        <div className="space-y-6 text-xs sm:text-sm">
          {/* Add Category Form */}
          <form onSubmit={handleCreateCategory} className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
            <h5 className="font-bold text-slate-800 text-xs uppercase tracking-wide">
              Crear Nueva Categoría
            </h5>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
              <div className="sm:col-span-2">
                <label className="block font-semibold text-slate-700 mb-1">Nombre:</label>
                <input
                  type="text"
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  placeholder="ej. Entradas & Aperitivos"
                  required
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg focus:ring-2 focus:ring-orange-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Orden:</label>
                <input
                  type="number"
                  min="1"
                  value={newCategorySort}
                  onChange={(e) => setNewCategorySort(parseInt(e.target.value, 10) || 1)}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg focus:ring-2 focus:ring-orange-500 focus:outline-none"
                />
              </div>
            </div>

            <div className="flex items-center justify-between pt-2">
              <Switch
                checked={newCategoryActive}
                onChange={setNewCategoryActive}
                label="Categoría Activa"
                size="sm"
              />
              <Button variant="primary" size="sm" type="submit" leftIcon={<Plus className="w-3.5 h-3.5" />}>
                Crear Categoría
              </Button>
            </div>
          </form>

          {/* Categories List */}
          <div className="space-y-2">
            <h5 className="font-bold text-slate-800 text-xs uppercase tracking-wide">
              Categorías Existentes ({categories.length})
            </h5>
            <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden">
              {categories.map((cat) => (
                <div key={cat.id} className="p-3 bg-white flex items-center justify-between gap-3 text-xs">
                  {editingCategory?.id === cat.id ? (
                    <form onSubmit={handleUpdateCategory} className="flex-1 flex items-center gap-2">
                      <input
                        type="text"
                        value={editingCategory.name}
                        onChange={(e) => setEditingCategory({ ...editingCategory, name: e.target.value })}
                        required
                        className="flex-1 px-2.5 py-1.5 border border-orange-400 rounded-lg focus:outline-none"
                      />
                      <input
                        type="number"
                        min="1"
                        value={editingCategory.sortOrder}
                        onChange={(e) =>
                          setEditingCategory({
                            ...editingCategory,
                            sortOrder: parseInt(e.target.value, 10) || 1,
                          })
                        }
                        className="w-16 px-2 py-1.5 border border-orange-400 rounded-lg focus:outline-none"
                      />
                      <Button variant="primary" size="sm" type="submit">
                        Guardar
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setEditingCategory(null)}>
                        Cancelar
                      </Button>
                    </form>
                  ) : (
                    <>
                      <div className="flex items-center gap-2">
                        <span className="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center font-bold text-slate-600 text-[11px]">
                          {cat.sortOrder}
                        </span>
                        <div>
                          <p className="font-bold text-slate-800">{cat.name}</p>
                          <p className="text-[10px] text-slate-400">slug: {cat.slug}</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <div className="flex items-center gap-1.5">
                          <Switch
                            checked={cat.isActive}
                            onChange={() => handleToggleCategoryActive(cat)}
                            size="sm"
                          />
                          <span className="text-[11px] font-semibold text-slate-600">
                            {cat.isActive ? 'Activa' : 'Inactiva'}
                          </span>
                        </div>

                        <button
                          type="button"
                          onClick={() => setEditingCategory({ ...cat })}
                          className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg"
                          title="Editar"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>

                        <button
                          type="button"
                          onClick={() => handleDeleteCategory(cat)}
                          className="p-1.5 text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded-lg"
                          title="Eliminar lógicamente"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </Modal>

      {/* ========================================== */}
      {/* DELETE PRODUCT CONFIRMATION MODAL          */}
      {/* ========================================== */}
      <Modal
        isOpen={isDeleteModalOpen}
        onClose={() => setIsDeleteModalOpen(false)}
        title="Eliminar Producto del Catálogo"
        maxWidth="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setIsDeleteModalOpen(false)}>
              Cancelar
            </Button>
            <Button variant="danger" size="sm" onClick={handleDeleteItem}>
              Confirmar Eliminación
            </Button>
          </div>
        }
      >
        <div className="space-y-3 text-xs sm:text-sm">
          <p className="text-slate-600">
            ¿Está seguro de eliminar el producto{' '}
            <span className="font-bold text-slate-900">&quot;{itemToDelete?.name}&quot;</span>?
          </p>
          <p className="text-slate-400 text-[11px]">
            Los pedidos históricos conservarán sus snapshots y no se verán afectados.
          </p>
        </div>
      </Modal>
    </div>
  );
};
