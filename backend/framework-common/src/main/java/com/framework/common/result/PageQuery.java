package com.framework.common.result;

import java.io.Serializable;

/**
 * 通用分页查询参数。页码从 1 开始。
 */
public class PageQuery implements Serializable {

    private static final int MAX_PAGE_SIZE = 200;

    private int pageNum = 1;
    private int pageSize = 10;

    public PageQuery() {
    }

    public PageQuery(int pageNum, int pageSize) {
        setPageNum(pageNum);
        setPageSize(pageSize);
    }

    public int getPageNum() {
        return pageNum;
    }

    public void setPageNum(int pageNum) {
        this.pageNum = Math.max(pageNum, 1);
    }

    public int getPageSize() {
        return pageSize;
    }

    public void setPageSize(int pageSize) {
        if (pageSize < 1) {
            pageSize = 10;
        }
        this.pageSize = Math.min(pageSize, MAX_PAGE_SIZE);
    }

    /** 零基偏移量，供 SQL LIMIT/OFFSET 使用。 */
    public long offset() {
        return (long) (pageNum - 1) * pageSize;
    }
}
