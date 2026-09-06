import { onMounted, ref } from 'vue';
import type { TablePaginationConfig } from 'ant-design-vue';
import type { ListResponse } from '@/types';
import { useTable } from './useTable';

interface UseResourceTableOptions<T, TSearch extends object> {
    initialSearchForm: TSearch;
    fetcher: (query: TSearch) => Promise<ListResponse<T>>;
    resetSearchForm: (searchForm: TSearch) => void;
    defaultPageSize?: number;
    immediate?: boolean;
}

export function useResourceTable<T, TSearch extends object>(
    options: UseResourceTableOptions<T, TSearch>,
) {
    const {
        initialSearchForm,
        fetcher,
        resetSearchForm,
        defaultPageSize = 10,
        immediate = true,
    } = options;

    const { loading, data, pagination, searchForm, setPage, clearData } = useTable<T, TSearch>(
        defaultPageSize,
        initialSearchForm,
    );
    const error = ref<unknown | null>(null);

    async function loadData(): Promise<void> {
        loading.value = true;
        error.value = null;
        try {
            const query = {
                ...searchForm,
                page: pagination.current,
                pageSize: pagination.pageSize,
            } as TSearch;
            const result = await fetcher(query);
            data.value = result.list;
            pagination.total = result.total;
        } catch (cause) {
            error.value = cause;
            data.value = [];
            pagination.total = 0;
        } finally {
            loading.value = false;
        }
    }

    function handleSearch(): void {
        pagination.current = 1;
        clearData();
        void loadData();
    }

    function handleReset(): void {
        resetSearchForm(searchForm as TSearch);
        pagination.current = 1;
        pagination.pageSize = defaultPageSize;
        clearData();
        void loadData();
    }

    function handleTableChange(pag: TablePaginationConfig): void {
        setPage(pag.current ?? 1, pag.pageSize ?? pagination.pageSize);
        void loadData();
    }

    if (immediate) {
        onMounted(() => {
            void loadData();
        });
    }

    return {
        loading,
        error,
        data,
        pagination,
        searchForm,
        loadData,
        handleSearch,
        handleReset,
        handleTableChange,
        clearData,
    };
}
