export const page = {
    get url(): URL {
        return new URL(location.href);
    },
    params: {} as Record<string, string>,
    data: {} as Record<string, unknown>,
    form: null
};
