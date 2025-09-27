export default async function() {
    if (process.platform === 'win32')
        return await this.use("msvc");
    else
        return await this.use("gcc");
}